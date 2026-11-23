/**
 * 「Apple でサインイン」の口（札 journey.photo-ios#601・2026-11-14 の案・2026-11-23 owner「すすめたい！」）。
 *
 * ## 流れ（押す回数は2回: ボタン → Face ID）
 *
 * 1. アプリが Apple の標準シートで identity token・認可コード・（初回だけ）名前を受け取る
 * 2. `POST /auth/apple`（ログイン不要）: token を Apple の公開鍵で確かめ、**今の Cognito の利用者**を決める
 *    （結ぶ・作る）。認可コードを Apple の更新トークンに替えて控える。答えは Cognito のユーザー名だけ
 * 3. アプリが Cognito の CUSTOM_AUTH でそのユーザー名にログインし、同じ identity token を答えとして出す。
 *    確かめは Cognito のトリガー（`appleAuthTrigger.ts`）がもう一度する。
 *    → 出てくるのは今と同じ Cognito のトークン。API の認可・トークンの更新・退会の流れはそのまま使える
 *
 * ## 行（users 表・新しい表と GSI は作らない）
 *
 * - `apple#<Apple の sub>` … { cognitoUsername, cognitoSub, refreshToken?, linkedAt, linkedBy, lastNonce? }
 *   🔴 `#` を含む行は人の行ではない（`userSearch.ts` の `isReservationItem` が検索から外す）
 * - プロフィールの行に `appleSub`（公開の答えには出さない: `toPublicProfile` は項目を選んで返し、
 *   本人の答え（`withBadgeFields`）からも落とす）
 *
 * ## 結び方（2026-11-14 の案のとおり）
 *
 * - Apple が**確かめ済み**としたメールが、**確かめ済み**のメールのアカウントと同じなら、そのアカウントに結ぶ
 * - メールを非公開にした人（転送アドレス）・合うアカウントが無い人は、新しいアカウントを作る
 * - 名前は Apple が最初の1回しか渡さないので、そのときだけ表示名に入れる（名前のある人は上書きしない）
 *
 * 退会のときは `POST /auth/apple/revoke` で Apple の更新トークンを取り消す（Apple の決まり）。
 */
import type { APIGatewayProxyHandlerV2, APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { randomBytes, randomUUID } from "node:crypto";
import {
    AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand,
    CognitoIdentityProviderClient, ListUsersCommand,
    type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import {
    appleConfigFromEnv, appleKey, exchangeAppleCode, revokeAppleToken, verifyAppleIdentityToken,
    AppleTokenError, type AppleClaims, type AppleKeyConfig, type FetchLike,
} from "./appleIdToken";

const USERS_TABLE = requireEnv("USERS_TABLE");

/** 投稿・編集ができる利用者のグループ（`api/src/cognitoTrigger.ts` と同じ。`admin` は絶対に入れない） */
export const USER_GROUP = "user";

/** 表示名の上限（プロフィール編集と同じ） */
export const DISPLAY_NAME_MAX = 100;

export const UNAVAILABLE_MESSAGE = "Apple でのサインインは今は使えません";
export const INVALID_TOKEN_MESSAGE = "Apple でのサインインを確かめられませんでした。もう一度お試しください";

/** 外へ話す口（試験で差し替える） */
export const appleDeps: {
    idp: { send: (cmd: unknown) => Promise<unknown> };
    fetchImpl?: FetchLike;
    config: () => AppleKeyConfig | null;
    poolId: () => string;
} = {
    idp: new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" }) as unknown as { send: (cmd: unknown) => Promise<unknown> },
    fetchImpl: undefined,
    config: () => appleConfigFromEnv(),
    poolId: () => (process.env.COGNITO_USER_POOL_ID ?? "").trim(),
};

/** この環境で使えるか（鍵・宛先・プールがそろっている） */
export function isAppleSigninAvailable(): boolean {
    return appleDeps.config() !== null && appleDeps.poolId() !== "";
}

const ok = (body: unknown) => ({
    statusCode: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    body: JSON.stringify(body),
});

type AppleRow = {
    userId: string;
    cognitoUsername?: string;
    cognitoSub?: string;
    refreshToken?: string;
};

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? "";

// ────────────────────────────── 表示名

/** 名前を整える（前後の空白・制御文字を落とし、上限で切る）。空なら undefined */
export function cleanDisplayName(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    // 制御文字（改行・タブを含む）は空白にする
    // eslint-disable-next-line no-control-regex
    const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return undefined;
    return [...s].slice(0, DISPLAY_NAME_MAX).join("");
}

// ────────────────────────────── Cognito

function attr(attrs: AttributeType[] | undefined, name: string): string | undefined {
    return attrs?.find((a) => a.Name === name)?.Value;
}

/** ListUsers の絞り込みに入れる値（`"` と `\` を逃がす） */
export function filterValue(v: string): string {
    return v.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

type CognitoUser = { username: string; sub: string };

/**
 * 確かめ済みのメールで、確かめ済み・有効な利用者を探す。
 * 🔴 **確かめていないメールのアカウントには結ばない**（他人がそのメールで登録だけしていた、を乗っ取らせない）
 */
export async function findVerifiedEmailUser(email: string): Promise<CognitoUser | null> {
    const variants = [...new Set([email, email.toLowerCase()])];
    for (const e of variants) {
        const res = await appleDeps.idp.send(new ListUsersCommand({
            UserPoolId: appleDeps.poolId(),
            Filter: `email = "${filterValue(e)}"`,
            Limit: 10,
        })) as { Users?: { Username?: string; Enabled?: boolean; UserStatus?: string; Attributes?: AttributeType[] }[] };
        for (const u of res.Users ?? []) {
            const sub = attr(u.Attributes, "sub");
            if (!u.Username || !sub) continue;
            if (u.Enabled === false || u.UserStatus !== "CONFIRMED") continue;
            if (attr(u.Attributes, "email_verified") !== "true") continue;
            return { username: u.Username, sub };
        }
    }
    return null;
}

/** Cognito にまだ居るか（退会で消えた利用者を指す古い行を見分ける） */
async function cognitoUserExists(username: string): Promise<boolean> {
    try {
        await appleDeps.idp.send(new AdminGetUserCommand({ UserPoolId: appleDeps.poolId(), Username: username }));
        return true;
    } catch (e) {
        if (errName(e) === "UserNotFoundException") return false;
        throw e;
    }
}

/**
 * 新しい利用者を作る。ユーザー名は UUID（メールの登録と同じ・`AuthGateway.signUp`）。
 * パスワードは本人も知らない長い乱数にして「確認済み」にする（CUSTOM_AUTH は確認済みの利用者にしか通らない）。
 * あとでメールのパスワードを使いたくなったら「パスワードを忘れた」で決められる（メールが届く人だけ）
 */
async function createCognitoUser(claims: AppleClaims): Promise<CognitoUser> {
    const username = randomUUID();
    const pool = appleDeps.poolId();
    const emailAttrs: AttributeType[] = claims.email
        ? [{ Name: "email", Value: claims.email }, { Name: "email_verified", Value: claims.emailVerified ? "true" : "false" }]
        : [];
    let created: { User?: { Attributes?: AttributeType[] } };
    try {
        created = await appleDeps.idp.send(new AdminCreateUserCommand({
            UserPoolId: pool, Username: username, UserAttributes: emailAttrs, MessageAction: "SUPPRESS",
        })) as typeof created;
    } catch (e) {
        // 確かめ済みのメールを別の（有効でない）利用者が持っていた。メール無しで作る（取り上げない）
        if (errName(e) !== "AliasExistsException" || emailAttrs.length === 0) throw e;
        created = await appleDeps.idp.send(new AdminCreateUserCommand({
            UserPoolId: pool, Username: username, UserAttributes: [], MessageAction: "SUPPRESS",
        })) as typeof created;
    }
    const sub = attr(created.User?.Attributes, "sub");
    if (!sub) throw new Error("AdminCreateUser: sub がありません");
    await appleDeps.idp.send(new AdminSetUserPasswordCommand({
        UserPoolId: pool, Username: username, Password: randomPassword(), Permanent: true,
    }));
    // メールの登録は PostConfirmation のトリガーが `user` グループに入れる。管理者の作成ではトリガーが動かないので、ここで入れる
    await appleDeps.idp.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: username, GroupName: USER_GROUP }));
    return { username, sub };
}

/** プールのパスワードの決まり（大小の英字・数字・記号・8字以上）を満たす、本人も知らない乱数 */
export function randomPassword(): string {
    return `Aa1!${randomBytes(30).toString("base64url")}`;
}

// ────────────────────────────── users 表

async function getRow<T>(userId: string): Promise<T | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId }, ConsistentRead: true }));
    return res.Item as T | undefined;
}

/** プロフィールの行を作る（無ければ）。名前は初回だけ */
async function createProfile(sub: string, displayName: string | undefined): Promise<void> {
    try {
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: { userId: sub, createdAt: new Date().toISOString(), ...(displayName ? { displayName } : {}) },
            ConditionExpression: "attribute_not_exists(userId)",
        }));
    } catch (e) {
        if (errName(e) !== "ConditionalCheckFailedException") throw e;
    }
}

/** プロフィールに Apple の番号を書く。名前は**無いときだけ**入れる（本人が付けた名前を上書きしない） */
async function markProfile(sub: string, appleSub: string, displayName: string | undefined): Promise<void> {
    try {
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: sub },
            UpdateExpression: displayName
                ? "SET appleSub = :a, displayName = if_not_exists(displayName, :n)"
                : "SET appleSub = :a",
            // 退会した人（墓石）の行は書き換えない
            ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(deletedAt)",
            ExpressionAttributeValues: { ":a": appleSub, ...(displayName ? { ":n": displayName } : {}) },
        }));
    } catch (e) {
        if (errName(e) !== "ConditionalCheckFailedException") throw e;
    }
}

export type LinkResult = { username: string; sub: string; via: "apple" | "email" | "new" };

/**
 * Apple の利用者を Cognito の利用者に結ぶ（無ければ作る）。
 * 1. 前に結んだ行があり、その利用者がまだ居れば、それ
 * 2. 確かめ済みのメールが、確かめ済みのメールのアカウントと同じなら、そこへ結ぶ
 * 3. それ以外は新しく作る
 */
export async function linkOrCreate(claims: AppleClaims, displayName: string | undefined): Promise<LinkResult> {
    const key = appleKey(claims.sub);
    const row = await getRow<AppleRow>(key);
    if (row?.cognitoUsername && row.cognitoSub) {
        if (await cognitoUserExists(row.cognitoUsername)) {
            return { username: row.cognitoUsername, sub: row.cognitoSub, via: "apple" };
        }
        // 退会で消えた利用者を指す古い行。消して作り直す（退会した人は新しい人として始める）
        await ddb.send(new DeleteCommand({ TableName: USERS_TABLE, Key: { userId: key } }));
    }

    let user: CognitoUser | null = null;
    let via: LinkResult["via"] = "new";
    if (claims.email && claims.emailVerified && !claims.isPrivateEmail) {
        user = await findVerifiedEmailUser(claims.email);
        if (user) via = "email";
    }
    if (!user) user = await createCognitoUser(claims);

    try {
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: {
                userId: key, cognitoUsername: user.username, cognitoSub: user.sub,
                linkedAt: new Date().toISOString(), linkedBy: via,
            },
            ConditionExpression: "attribute_not_exists(userId)",
        }));
    } catch (e) {
        if (errName(e) !== "ConditionalCheckFailedException") throw e;
        // 同じ Apple の人が2つの端末で同時に押した。先に書けた方に合わせる
        const won = await getRow<AppleRow>(key);
        if (won?.cognitoUsername && won.cognitoSub) return { username: won.cognitoUsername, sub: won.cognitoSub, via: "apple" };
        throw e;
    }
    if (via === "new") await createProfile(user.sub, displayName);
    await markProfile(user.sub, claims.sub, displayName);
    return { username: user.username, sub: user.sub, via };
}

/** 更新トークンを行に書く（新しいものに入れ替える） */
async function saveRefreshToken(appleSub: string, refreshToken: string): Promise<void> {
    await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId: appleKey(appleSub) },
        UpdateExpression: "SET refreshToken = :t, tokenAt = :at",
        ConditionExpression: "attribute_exists(userId)",
        ExpressionAttributeValues: { ":t": refreshToken, ":at": new Date().toISOString() },
    }));
}

// ────────────────────────────── 口

/** `GET /auth/apple/status`（ログイン不要）。アプリはこれが `available: true` のときだけボタンを出す */
export const getAppleSigninStatus: APIGatewayProxyHandlerV2 = async () => ok({ available: isAppleSigninAvailable() });

type StartBody = { identityToken?: unknown; authorizationCode?: unknown; displayName?: unknown };

/** `POST /auth/apple`（ログイン不要）。答えは Cognito のユーザー名だけ */
export const startAppleSignin: APIGatewayProxyHandlerV2 = async (event) => {
    const cfg = appleDeps.config();
    if (!cfg || !appleDeps.poolId()) return jsonError(503, UNAVAILABLE_MESSAGE, "apple_signin_unavailable");

    let body: StartBody;
    try {
        body = JSON.parse(event.body ?? "{}") as StartBody;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    if (!body || typeof body !== "object") return jsonError(400, "不正なリクエスト");

    let claims: AppleClaims;
    try {
        claims = await verifyAppleIdentityToken(body.identityToken, { clientIds: [cfg.clientId], fetchImpl: appleDeps.fetchImpl });
    } catch (e) {
        if (!(e instanceof AppleTokenError)) console.error("startAppleSignin: verify", e);
        else console.warn(`startAppleSignin: ${e.reason}`);
        return jsonError(401, INVALID_TOKEN_MESSAGE, "apple_token_invalid");
    }
    // アプリはいつも nonce を入れる。無い token は使い回しを止められないので受けない（`appleAuthTrigger.ts`）
    if (!claims.nonce) return jsonError(401, INVALID_TOKEN_MESSAGE, "apple_token_invalid");

    try {
        const linked = await linkOrCreate(claims, cleanDisplayName(body.displayName));
        const code = typeof body.authorizationCode === "string" && body.authorizationCode.length <= 1024
            ? body.authorizationCode : "";
        if (code) {
            // 取れなくてもログインは止めない（次のログインでまた取る）
            try {
                const refresh = await exchangeAppleCode(cfg, code, appleDeps.fetchImpl);
                if (refresh) await saveRefreshToken(claims.sub, refresh);
            } catch (e) {
                console.warn("startAppleSignin: token exchange", errName(e));
            }
        }
        // 数え方は登録の1行と同じ形（uid・メールは出さない・`api/src/cognitoTrigger.ts` の signupMetricLine）
        if (linked.via === "new") console.log(JSON.stringify({ metric: "signup", platform: "ios", from: "apple" }));
        return ok({ username: linked.username, created: linked.via === "new" });
    } catch (e) {
        console.error("startAppleSignin:", errName(e));
        return jsonError(500, "サインインを完了できませんでした。しばらくしてからもう一度お試しください");
    }
};

/**
 * `POST /auth/apple/revoke`（ログインの口）。退会の前にアプリが呼ぶ。
 * Apple の更新トークンを取り消し、Apple の行とプロフィールの `appleSub` を消す。
 * Apple で入っていない人は何もせず `revoked: false`
 */
export const revokeAppleSignin: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!uid) return jsonError(401, "認証が必要です");
    try {
        const profile = await getRow<{ appleSub?: unknown }>(uid);
        const appleSub = typeof profile?.appleSub === "string" ? profile.appleSub : "";
        if (!appleSub) return ok({ revoked: false });
        const row = await getRow<AppleRow>(appleKey(appleSub));
        // 🔴 行が呼んだ本人のものでなければ触らない
        if (row && row.cognitoSub !== uid) return ok({ revoked: false });
        if (row?.refreshToken) {
            const cfg = appleDeps.config();
            if (!cfg) return jsonError(503, UNAVAILABLE_MESSAGE, "apple_signin_unavailable");
            if (!(await revokeAppleToken(cfg, row.refreshToken, appleDeps.fetchImpl))) {
                return jsonError(502, "Apple との連携を解除できませんでした。もう一度お試しください", "apple_revoke_failed");
            }
        }
        if (row) await ddb.send(new DeleteCommand({ TableName: USERS_TABLE, Key: { userId: appleKey(appleSub) } }));
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE, Key: { userId: uid },
            UpdateExpression: "REMOVE appleSub",
            ConditionExpression: "attribute_exists(userId)",
        })).catch((e) => { if (errName(e) !== "ConditionalCheckFailedException") throw e; });
        return ok({ revoked: true });
    } catch (e) {
        console.error("revokeAppleSignin:", errName(e));
        return jsonError(500, "Apple との連携を解除できませんでした。もう一度お試しください");
    }
};
