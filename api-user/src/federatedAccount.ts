/**
 * 外のアカウントでのサインイン（Apple・札 journey.photo-ios#601。次に Google・#715）の、提供元によらない土台。
 *
 * 提供元（`provider`）は1つの欄で分ける。提供元ごとに違うのは「token の確かめ」「退会のときの取り消し」だけで、
 * それは提供元のモジュール（Apple は `appleIdToken.ts`・`appleSignin.ts`）が持つ。ここが持つのは:
 *
 * - 行（users 表・新しい表と GSI は作らない）
 *   - `<provider>#<sub>` … { provider, cognitoUsername, cognitoSub, linkedAt, linkedBy, refreshToken?, ticketHash?, ticketExpiresAt? }
 *   - `nonce#<provider>#<sha256>` … 使った nonce（1回きり・`ttl` 付き。🔴 users 表の TTL はまだ無効（#295）なので、
 *     有効にするまでは消えずに残る。中身は SHA-256 と時刻だけ）
 *   - プロフィールの行に `<provider>Sub`（例 `appleSub`。公開の答えにも本人の答えにも出さない）
 *   🔴 `#` を含む行は人の行ではない（`userSearch.ts` の `isReservationItem` が検索から外す）
 * - 結び方（`linkOrCreate`）
 * - CUSTOM_AUTH の使い捨ての券（`issueTicket`・`consumeTicket`）
 * - 退会のときの取り消しと結び付けの片付け（`revokeLinkedTokens`・`unlinkAfterDelete`。`account.ts` が呼ぶ）
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
    AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDeleteUserCommand, AdminGetUserCommand,
    AdminListGroupsForUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient, ListUsersCommand,
    type AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { requestLinkNotice } from "./federatedNoticeClient";

const USERS_TABLE = requireEnv("USERS_TABLE");

/** 提供元。Google（#715）を足すときはここに足す */
export type Provider = "apple" | "google";
export const PROVIDERS: readonly Provider[] = ["apple", "google"];
export const isProvider = (v: unknown): v is Provider => typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

/** 提供元の利用者の行の鍵（`apple#<sub>`） */
export const federatedKey = (provider: Provider, sub: string) => `${provider}#${sub}`;
/** プロフィールの行の欄の名前（`appleSub`） */
export const subField = (provider: Provider) => `${provider}Sub` as const;
/**
 * プロフィールの行の「本人が外した」印の欄の名前（`appleUnlinkedAt`）。
 * 2026-11-23 判断（札 journey.photo-ios#601・owner「心当たりが無ければ、こちらから外せます」）: 本人が外した提供元には、
 * メールが同じでも**自動ではもう結ばない**（外したのに、次にその提供元で入ると黙って結び直される、を作らない）
 */
export const unlinkedField = (provider: Provider) => `${provider}UnlinkedAt` as const;
/**
 * プロフィールの行の「外のアカウントで新しく作った人」の印（`federatedSignup: "apple"`）。
 * この人はメールのパスワードを知らない（本人も知らない乱数・`createCognitoUser`）。「サインインの方法」で最後の1つを
 * 外させないために見る（`signinMethods.ts`）。パスワードを設定し直したら `passwordKey` の行ができる
 */
export const FEDERATED_SIGNUP_FIELD = "federatedSignup";
/**
 * メールのパスワードを本人が決めた印の行（`password#<uid>`・中身は時刻だけ）。Cognito の PostConfirmation の
 * `PostConfirmation_ConfirmForgotPassword`（パスワードの再設定）で `api/src/cognitoTrigger.ts` が書く
 */
export const passwordKey = (uid: string) => `password#${uid}`;
/** 使った nonce の行の鍵 */
export const nonceKey = (provider: Provider, nonceHash: string) => `nonce#${provider}#${nonceHash}`;

/** 投稿・編集ができる利用者のグループ（`api/src/cognitoTrigger.ts` と同じ。`admin` は絶対に入れない） */
export const USER_GROUP = "user";
/** 🔴 このグループの人には、メールで自動では結ばない（管理者のアカウントを、メールが同じだけの外の ID で開けさせない） */
export const ADMIN_GROUP = "admin";
/** 表示名の上限（プロフィール編集と同じ） */
export const DISPLAY_NAME_MAX = 100;
/** 券の寿命 */
export const TICKET_TTL_MS = 5 * 60 * 1000;
/**
 * 使った nonce を覚える長さ（token の寿命より十分長く）。`ttl` は users 表の TTL の欄（`account.ts` の墓石と同じ）。
 * 🔴 TTL はまだ無効（#295）なので、今は消えない（有効にすればこの期限で消える）
 */
export const NONCE_KEEP_SEC = 24 * 60 * 60;
/** 結ぶ途中の印（同時に2回来たとき、後から来た方を待たせる）の寿命 */
export const CLAIM_STALE_MS = 60 * 1000;

/** 確かめ終えた外の ID（提供元によらない形） */
export type FederatedIdentity = {
    provider: Provider;
    sub: string;
    email?: string;
    emailVerified: boolean;
    /** 転送アドレス（Apple の「メールを非公開」）。同じメールのアカウントを探さない */
    isPrivateEmail: boolean;
};

/** 外へ話す口（試験で差し替える） */
export const federatedDeps: {
    idp: { send: (cmd: unknown) => Promise<unknown> };
    poolId: () => string;
    now: () => number;
    /**
     * メールで自動で結んだことを持ち主の端末へ知らせる。🔴 サインインの口は APNs の鍵を持たないので、
     * 知らせだけをする関数（`federatedNotice.ts`）に頼む（`federatedNoticeClient.ts`・2026-11-23 確かめ役の3回目）
     */
    notifyLinked: (cognitoSub: string, provider: Provider) => Promise<void>;
} = {
    idp: new CognitoIdentityProviderClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" }) as unknown as { send: (cmd: unknown) => Promise<unknown> },
    poolId: () => (process.env.COGNITO_USER_POOL_ID ?? "").trim(),
    now: () => Date.now(),
    notifyLinked: requestLinkNotice,
};

/** 結ぶ途中で、別の回が先に始めている（少し待ってもう一度） */
export class LinkBusyError extends Error {
    constructor() {
        super("link in progress");
        this.name = "LinkBusyError";
    }
}

/**
 * 本人が「サインインの方法」で解除した提供元で、また入ろうとした（2026-11-23 確かめ役の指摘）。
 * 黙って空の別アカウントを作らず、断る（口は 409。アプリはこの文をログイン画面に出す）
 */
export class UnlinkedProviderError extends Error {
    constructor(readonly provider: Provider) {
        super("provider unlinked");
        this.name = "UnlinkedProviderError";
    }
}

/** 解除した提供元で入ろうとしたときの文（ログイン画面の失敗の文） */
export function unlinkedMessage(provider: Provider): string {
    return provider === "apple"
        ? "この Apple ID の連携は解除されています。メールアドレスでログインしてください"
        : "この Google アカウントの連携は解除されています。メールアドレスでログインしてください";
}

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? "";
export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

// ────────────────────────────── 表示名

/** 名前を整える（前後の空白・制御文字を落とし、上限で切る）。空なら undefined */
export function cleanDisplayName(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    // eslint-disable-next-line no-control-regex
    const s = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (!s) return undefined;
    return [...s].slice(0, DISPLAY_NAME_MAX).join("");
}

// ────────────────────────────── nonce

/**
 * nonce を照らして1回きりにする。アプリは乱数（元の値）を作り、その SHA-256 を提供元に渡す。
 * 提供元の token には SHA-256 が入り、アプリはサーバーに元の値を送る。
 * 🔴 盗まれた token だけでは元の値が分からないので通らない。元の値ごと盗まれても、使った nonce は2回通らない
 *
 * @returns 照らせて、初めて使う nonce なら true
 */
export async function useNonce(provider: Provider, rawNonce: unknown, tokenNonce: string | undefined): Promise<boolean> {
    if (typeof rawNonce !== "string" || rawNonce.length < 16 || rawNonce.length > 256 || !tokenNonce) return false;
    const hash = sha256Hex(rawNonce);
    const a = Buffer.from(hash);
    const b = Buffer.from(tokenNonce);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    const nowSec = Math.floor(federatedDeps.now() / 1000);
    try {
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: { userId: nonceKey(provider, hash), usedAt: new Date(federatedDeps.now()).toISOString(), ttl: nowSec + NONCE_KEEP_SEC },
            ConditionExpression: "attribute_not_exists(userId)",
        }));
        return true;
    } catch (e) {
        if (errName(e) === "ConditionalCheckFailedException") return false;
        throw e;
    }
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

async function isAdminUser(username: string): Promise<boolean> {
    const res = await federatedDeps.idp.send(new AdminListGroupsForUserCommand({
        UserPoolId: federatedDeps.poolId(), Username: username, Limit: 60,
    })) as { Groups?: { GroupName?: string }[] };
    return (res.Groups ?? []).some((g) => g.GroupName === ADMIN_GROUP);
}

/**
 * 確かめ済みのメールで、自動で結んでよい利用者を探す。結んでよいのは次の全部を満たす人だけ:
 * - Cognito でメールが確かめ済み・有効・確認済み
 * - `admin` グループに入っていない
 * - その提供元の別の ID とまだ結んでいない（プロフィールに `<provider>Sub` が無い）
 */
export async function findLinkableEmailUser(provider: Provider, email: string): Promise<CognitoUser | null> {
    const variants = [...new Set([email, email.toLowerCase()])];
    for (const e of variants) {
        const res = await federatedDeps.idp.send(new ListUsersCommand({
            UserPoolId: federatedDeps.poolId(),
            Filter: `email = "${filterValue(e)}"`,
            Limit: 10,
        })) as { Users?: { Username?: string; Enabled?: boolean; UserStatus?: string; Attributes?: AttributeType[] }[] };
        for (const u of res.Users ?? []) {
            const sub = attr(u.Attributes, "sub");
            if (!u.Username || !sub) continue;
            if (u.Enabled === false || u.UserStatus !== "CONFIRMED") continue;
            if (attr(u.Attributes, "email_verified") !== "true") continue;
            if (await isAdminUser(u.Username)) return null;
            const profile = await getRow<Record<string, unknown>>(sub);
            if (profile && typeof profile[subField(provider)] === "string") return null;
            // 🔴 本人が「サインインの方法」で外した提供元には、自動で結び直さない（`unlinkedField`）
            if (profile && profile[unlinkedField(provider)] !== undefined) return null;
            return { username: u.Username, sub };
        }
    }
    return null;
}

/**
 * このメール（確かめ済み）を持つ人が、この提供元を「サインインの方法」で解除しているか。
 * 🔴 解除した人と同じメールで来たら、新しく作らない（メール無しで作る道も含めて・`UnlinkedProviderError`）
 */
export async function emailOwnerUnlinked(provider: Provider, email: string): Promise<boolean> {
    for (const e of [...new Set([email, email.toLowerCase()])]) {
        const res = await federatedDeps.idp.send(new ListUsersCommand({
            UserPoolId: federatedDeps.poolId(), Filter: `email = "${filterValue(e)}"`, Limit: 10,
        })) as { Users?: { Attributes?: AttributeType[] }[] };
        for (const u of res.Users ?? []) {
            const sub = attr(u.Attributes, "sub");
            if (!sub) continue;
            const profile = await getRow<Record<string, unknown>>(sub);
            if (profile && profile.deletedAt === undefined && profile[unlinkedField(provider)] !== undefined) return true;
        }
    }
    return false;
}

async function cognitoUserExists(username: string): Promise<boolean> {
    try {
        await federatedDeps.idp.send(new AdminGetUserCommand({ UserPoolId: federatedDeps.poolId(), Username: username }));
        return true;
    } catch (e) {
        if (errName(e) === "UserNotFoundException") return false;
        throw e;
    }
}

/**
 * 新しい利用者を作る。ユーザー名は UUID（メールの登録と同じ・`AuthGateway.signUp`）。
 * パスワードは本人も知らない長い乱数にして「確認済み」にする（CUSTOM_AUTH は確認済みの利用者にしか通らない）
 */
async function createCognitoUser(identity: FederatedIdentity): Promise<CognitoUser> {
    const username = randomUUID();
    const pool = federatedDeps.poolId();
    const emailAttrs: AttributeType[] = identity.email
        ? [{ Name: "email", Value: identity.email }, { Name: "email_verified", Value: identity.emailVerified ? "true" : "false" }]
        : [];
    let created: { User?: { Attributes?: AttributeType[] } };
    try {
        created = await federatedDeps.idp.send(new AdminCreateUserCommand({
            UserPoolId: pool, Username: username, UserAttributes: emailAttrs, MessageAction: "SUPPRESS",
        })) as typeof created;
    } catch (e) {
        // 確かめ済みのメールを、結ばない人（管理者・別の ID と結び済み）が持っている。メール無しで作る（取り上げない）
        if (errName(e) !== "AliasExistsException" || emailAttrs.length === 0) throw e;
        // 🔴 ただし、そのメールの持ち主がこの提供元を解除しているなら作らない（黙って空の別アカウントを作らない）
        if (identity.email && await emailOwnerUnlinked(identity.provider, identity.email)) {
            throw new UnlinkedProviderError(identity.provider);
        }
        created = await federatedDeps.idp.send(new AdminCreateUserCommand({
            UserPoolId: pool, Username: username, UserAttributes: [], MessageAction: "SUPPRESS",
        })) as typeof created;
    }
    const sub = attr(created.User?.Attributes, "sub");
    try {
        if (!sub) throw new Error("AdminCreateUser: sub がありません");
        await federatedDeps.idp.send(new AdminSetUserPasswordCommand({
            UserPoolId: pool, Username: username, Password: randomPassword(), Permanent: true,
        }));
        // メールの登録は PostConfirmation のトリガーが `user` に入れる。管理者の作成ではトリガーが動かないので、ここで入れる
        await federatedDeps.idp.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: username, GroupName: USER_GROUP }));
    } catch (e) {
        // 途中で落ちた利用者を残さない
        await federatedDeps.idp.send(new AdminDeleteUserCommand({ UserPoolId: pool, Username: username })).catch(() => undefined);
        throw e;
    }
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

export type FederatedRow = {
    userId: string;
    provider?: string;
    cognitoUsername?: string;
    cognitoSub?: string;
    /** どう結んだか（`LinkResult["via"]` の `email`・`new`） */
    linkedBy?: string;
    /** 本人が「サインインの方法」で解除した時刻（取り消しが済まず、行を残したときだけ） */
    unlinkedAt?: string;
    refreshToken?: string;
    claimedAt?: number;
    ticketHash?: string;
    ticketExpiresAt?: number;
};

export const readFederatedRow = (provider: Provider, sub: string) => getRow<FederatedRow>(federatedKey(provider, sub));

async function createProfile(sub: string, displayName: string | undefined, signupVia?: Provider): Promise<void> {
    try {
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: {
                userId: sub, createdAt: new Date(federatedDeps.now()).toISOString(),
                ...(displayName ? { displayName } : {}),
                // 外のアカウントで新しく作った人（メールのパスワードを持たない）の印（`FEDERATED_SIGNUP_FIELD`）
                ...(signupVia ? { [FEDERATED_SIGNUP_FIELD]: signupVia } : {}),
            },
            ConditionExpression: "attribute_not_exists(userId)",
        }));
    } catch (e) {
        if (errName(e) !== "ConditionalCheckFailedException") throw e;
    }
}

/**
 * プロフィールに提供元の番号を書く。名前は**無いときだけ**入れる。
 * 🔴 別の ID と結び済みの番号は上書きしない（条件で止める）
 */
export async function markProfile(provider: Provider, sub: string, providerSub: string, displayName: string | undefined): Promise<void> {
    const field = subField(provider);
    await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId: sub },
        UpdateExpression: displayName ? "SET #f = :a, displayName = if_not_exists(displayName, :n)" : "SET #f = :a",
        ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(deletedAt) AND (attribute_not_exists(#f) OR #f = :a)",
        ExpressionAttributeNames: { "#f": field },
        ExpressionAttributeValues: { ":a": providerSub, ...(displayName ? { ":n": displayName } : {}) },
    })).catch((e) => {
        if (errName(e) !== "ConditionalCheckFailedException") throw e;
    });
}

export type LinkResult = { username: string; sub: string; via: "known" | "email" | "new" };

/**
 * 外の ID を Cognito の利用者に結ぶ（無ければ作る）。
 * 1. 前に結んだ行があり、その利用者がまだ居れば、それ
 * 2. 確かめ済みのメールが、自動で結んでよいアカウント（`findLinkableEmailUser`）と同じなら、そこへ結ぶ
 * 3. それ以外は新しく作る
 *
 * 🔴 **先に行を取ってから作る。** 同じ ID で同時に2回来ても、Cognito の利用者は1人しか作らない。
 *    後から来た方は `LinkBusyError`（口は 409 を返し、アプリはもう一度押してもらう）
 */
export async function linkOrCreate(identity: FederatedIdentity, displayName: string | undefined): Promise<LinkResult> {
    const key = federatedKey(identity.provider, identity.sub);
    const row = await getRow<FederatedRow>(key);
    // 🔴 解除して行だけ残した ID（取り消しが済まなかった）では入れない
    if (row?.unlinkedAt !== undefined) throw new UnlinkedProviderError(identity.provider);
    if (row?.cognitoUsername && row.cognitoSub) {
        if (await cognitoUserExists(row.cognitoUsername)) {
            // 前の回で、結び付けの行を書いたあとプロフィールの書き込みが落ちていても、ここで直す
            // （2026-11-23 確かめ役の指摘。どちらも何度呼んでも同じ: 無いときだけ作る・同じ番号なら書き直すだけ）
            await createProfile(row.cognitoSub, displayName, row.linkedBy === "new" ? identity.provider : undefined);
            await markProfile(identity.provider, row.cognitoSub, identity.sub, displayName);
            return { username: row.cognitoUsername, sub: row.cognitoSub, via: "known" };
        }
        // 退会で消えた利用者を指す古い行。消して作り直す（条件付き: 同時に作り直している回とぶつけない）
        await ddb.send(new DeleteCommand({
            TableName: USERS_TABLE, Key: { userId: key },
            ConditionExpression: "cognitoUsername = :u",
            ExpressionAttributeValues: { ":u": row.cognitoUsername },
        })).catch((e) => { if (errName(e) !== "ConditionalCheckFailedException") throw e; });
    } else if (row && typeof row.claimedAt === "number" && federatedDeps.now() - row.claimedAt < CLAIM_STALE_MS) {
        throw new LinkBusyError();
    }

    // 行を取る（途中の印）。古い印（落ちた回の残り）は取り直してよい
    const now = federatedDeps.now();
    try {
        await ddb.send(new PutCommand({
            TableName: USERS_TABLE,
            Item: { userId: key, provider: identity.provider, claimedAt: now },
            ConditionExpression: "attribute_not_exists(userId) OR (attribute_not_exists(cognitoUsername) AND claimedAt < :stale)",
            ExpressionAttributeValues: { ":stale": now - CLAIM_STALE_MS },
        }));
    } catch (e) {
        if (errName(e) === "ConditionalCheckFailedException") throw new LinkBusyError();
        throw e;
    }

    let user: CognitoUser | null = null;
    let via: LinkResult["via"] = "new";
    try {
        if (identity.email && identity.emailVerified && !identity.isPrivateEmail) {
            user = await findLinkableEmailUser(identity.provider, identity.email);
            if (user) via = "email";
        }
        // 🔴 解除した人と同じ確かめ済みのメールで来たら、作らずに断る。非公開の転送アドレスは探さない（今までどおり）が、
        //    前に結んだ人のアドレスなら作る途中で AliasExists になり、そこで同じく断る（`createCognitoUser`）
        if (!user && identity.email && identity.emailVerified && !identity.isPrivateEmail
            && await emailOwnerUnlinked(identity.provider, identity.email)) {
            throw new UnlinkedProviderError(identity.provider);
        }
        if (!user) user = await createCognitoUser(identity);
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: key },
            UpdateExpression: "SET cognitoUsername = :u, cognitoSub = :s, linkedAt = :at, linkedBy = :by REMOVE claimedAt",
            ConditionExpression: "claimedAt = :c",
            ExpressionAttributeValues: {
                ":u": user.username, ":s": user.sub, ":at": new Date(federatedDeps.now()).toISOString(), ":by": via, ":c": now,
            },
        }));
    } catch (e) {
        // 印を外す。作った利用者は消す（結び先の無い利用者を残さない）
        if (user && via === "new") {
            await federatedDeps.idp.send(new AdminDeleteUserCommand({ UserPoolId: federatedDeps.poolId(), Username: user.username })).catch(() => undefined);
        }
        await ddb.send(new DeleteCommand({
            TableName: USERS_TABLE, Key: { userId: key },
            ConditionExpression: "claimedAt = :c", ExpressionAttributeValues: { ":c": now },
        })).catch(() => undefined);
        throw e;
    }
    if (via === "new") await createProfile(user.sub, displayName, identity.provider);
    await markProfile(identity.provider, user.sub, identity.sub, displayName);
    if (via === "email") {
        // 🔴 メールで自動で結んだことを残し、持ち主に知らせる（`federatedNotice.ts`）。ログに人の情報は出さない
        console.log(JSON.stringify({ metric: "federated_link", provider: identity.provider, via }));
        await federatedDeps.notifyLinked(user.sub, identity.provider)
            .catch((e) => console.warn("federated link notice:", errName(e)));
    }
    return { username: user.username, sub: user.sub, via };
}

/** 更新トークン（退会のときに取り消す）を行に書く */
export async function saveRefreshToken(provider: Provider, sub: string, refreshToken: string): Promise<void> {
    await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId: federatedKey(provider, sub) },
        UpdateExpression: "SET refreshToken = :t, tokenAt = :at",
        ConditionExpression: "attribute_exists(cognitoUsername)",
        ExpressionAttributeValues: { ":t": refreshToken, ":at": new Date(federatedDeps.now()).toISOString() },
    }));
}

// ────────────────────────────── 券（CUSTOM_AUTH の答え）

/** 券の答えの形: `<provider>:<sub>:<券>`（券は base64url で `:` を含まない） */
export function ticketAnswer(provider: Provider, sub: string, ticket: string): string {
    return `${provider}:${sub}:${ticket}`;
}

export function parseTicketAnswer(answer: unknown): { provider: Provider; sub: string; ticket: string } | null {
    if (typeof answer !== "string" || answer.length > 600) return null;
    const first = answer.indexOf(":");
    const last = answer.lastIndexOf(":");
    if (first <= 0 || last <= first) return null;
    const provider = answer.slice(0, first);
    const sub = answer.slice(first + 1, last);
    const ticket = answer.slice(last + 1);
    if (!isProvider(provider) || !sub || !/^[A-Za-z0-9_-]{32,}$/.test(ticket)) return null;
    return { provider, sub, ticket };
}

/** 使い捨ての券を作る（5分）。行には SHA-256 だけを書く。答え（アプリが Cognito に出す文字）を返す */
export async function issueTicket(provider: Provider, sub: string): Promise<string> {
    const ticket = randomBytes(32).toString("base64url");
    await ddb.send(new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { userId: federatedKey(provider, sub) },
        UpdateExpression: "SET ticketHash = :h, ticketExpiresAt = :e",
        ConditionExpression: "attribute_exists(cognitoUsername)",
        ExpressionAttributeValues: { ":h": sha256Hex(ticket), ":e": federatedDeps.now() + TICKET_TTL_MS },
    }));
    return ticketAnswer(provider, sub, ticket);
}

/**
 * 券を照らして消す（Cognito の Verify のトリガー）。通してよいのは次の全部を満たすときだけ:
 * 行がこの Cognito の利用者を指している・券が期限内・券が合う（時間の差が出ない比べ方）・消せた（1回きり）
 */
export async function consumeTicket(answer: unknown, cognitoUsername: string, cognitoSub: string): Promise<boolean> {
    const parsed = parseTicketAnswer(answer);
    if (!parsed || !cognitoUsername || !cognitoSub) return false;
    const row = await readFederatedRow(parsed.provider, parsed.sub);
    if (!row || row.cognitoUsername !== cognitoUsername || row.cognitoSub !== cognitoSub) return false;
    // 解除した後に残した行の券は通さない（解除の前に出した券を含めて）
    if (row.unlinkedAt !== undefined) return false;
    if (typeof row.ticketHash !== "string" || typeof row.ticketExpiresAt !== "number") return false;
    if (row.ticketExpiresAt < federatedDeps.now()) return false;
    const got = Buffer.from(sha256Hex(parsed.ticket));
    const want = Buffer.from(row.ticketHash);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
    try {
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: federatedKey(parsed.provider, parsed.sub) },
            UpdateExpression: "REMOVE ticketHash, ticketExpiresAt SET signedInAt = :at",
            ConditionExpression: "ticketHash = :h AND cognitoUsername = :u",
            ExpressionAttributeValues: { ":h": row.ticketHash, ":u": cognitoUsername, ":at": new Date(federatedDeps.now()).toISOString() },
        }));
    } catch (e) {
        if (errName(e) === "ConditionalCheckFailedException") return false;
        throw e;
    }
    return true;
}

// ────────────────────────────── 退会

/** 提供元の更新トークンを取り消す口（Apple は `appleSignin.ts` の `appleRevoker`） */
export type Revoker = (refreshToken: string) => Promise<"revoked" | "failed" | "rejected" | "unavailable">;

type ProfileLike = Record<string, unknown> | undefined;

/** プロフィール（墓石を含む）に書いてある、結び付けた提供元と番号 */
export function linkedSubs(profile: ProfileLike): { provider: Provider; sub: string }[] {
    return PROVIDERS.flatMap((provider) => {
        const sub = profile?.[subField(provider)];
        return typeof sub === "string" && sub ? [{ provider, sub }] : [];
    });
}

/** プロフィールの結び付けの欄だけ（`{ appleSub: "…" }`）。墓石に写す */
export function linkedFields(profile: ProfileLike): Record<string, string> {
    return Object.fromEntries(linkedSubs(profile).map(({ provider, sub }) => [subField(provider), sub]));
}

/**
 * 退会の前半（**墓石を書く前**・`deleteAccount`）: 結び付けた提供元の更新トークンを取り消す。
 *
 * - 取り消せたら、行からトークンだけ消す（結び付けの行は残す。退会が後で落ちても、また同じ ID で入れる）
 * - 提供元が落ちている・届かない（`failed`・5xx と時間切れだけ）なら `false`。退会はここで止まり（500）、
 *   結び付けはそのまま残る。押し直せば続きから
 * - 提供元が断った（`rejected`・4xx）・この環境に鍵が無い（`unavailable`）ときは止めない（2026-11-23 確かめ役の指摘:
 *   止めると退会がずっとできない）。`console.error` で見張りに出し、トークンは行に残す。行と墓石の番号には
 *   墓石と同じ `ttl` を付けるが、🔴 users 表の TTL はまだ無効（#295）なので、今は消えずに残る
 *
 * 何度呼んでも同じ結果になる（取り消し済みならトークンが無いので何もしない）
 */
export async function revokeLinkedTokens(
    uid: string, profile: ProfileLike, revokers: Partial<Record<Provider, Revoker>>,
): Promise<boolean> {
    for (const { provider, sub } of linkedSubs(profile)) {
        const row = await readFederatedRow(provider, sub);
        // 🔴 行が呼んだ本人のものでなければ触らない
        if (!row || row.cognitoSub !== uid || typeof row.refreshToken !== "string") continue;
        const revoker = revokers[provider];
        const result = revoker ? await revoker(row.refreshToken) : "unavailable";
        if (result === "failed") return false;
        if (result === "unavailable" || result === "rejected") {
            console.error(`deleteAccount: ${provider} の更新トークンを取り消せませんでした（${result}）。退会は進め、行は残す`);
            continue;
        }
        await ddb.send(new UpdateCommand({
            TableName: USERS_TABLE,
            Key: { userId: federatedKey(provider, sub) },
            UpdateExpression: "REMOVE refreshToken SET revokedAt = :at",
            ConditionExpression: "refreshToken = :t",
            ExpressionAttributeValues: { ":t": row.refreshToken, ":at": new Date(federatedDeps.now()).toISOString() },
        })).catch((e) => { if (errName(e) !== "ConditionalCheckFailedException") throw e; });
    }
    return true;
}

/**
 * 退会の後半（**墓石を書いた後**）: 結び付けの行を消し、墓石の番号も消す（取り消し済みのものだけ）。
 * 取り消しが済んでいない（鍵が無かった・断られた）ものは、行に墓石と同じ `ttl` を付けて残す
 * （🔴 users 表の TTL はまだ無効（#295）なので、今は消えない）。
 * **投げない**（墓石の後なので退会は止めない。行が残っても、`linkOrCreate` は消えた利用者を指す行を作り直す）
 */
export async function unlinkAfterDelete(uid: string, profile: ProfileLike, ttl: number): Promise<void> {
    for (const { provider, sub } of linkedSubs(profile)) {
        try {
            const key = federatedKey(provider, sub);
            const row = await readFederatedRow(provider, sub);
            if (row && row.cognitoSub === uid && typeof row.refreshToken === "string") {
                await ddb.send(new UpdateCommand({
                    TableName: USERS_TABLE, Key: { userId: key },
                    UpdateExpression: "SET #ttl = :ttl",
                    ConditionExpression: "cognitoSub = :uid",
                    ExpressionAttributeNames: { "#ttl": "ttl" },
                    ExpressionAttributeValues: { ":ttl": ttl, ":uid": uid },
                }));
                continue;
            }
            if (row && row.cognitoSub === uid) {
                await ddb.send(new DeleteCommand({
                    TableName: USERS_TABLE, Key: { userId: key },
                    ConditionExpression: "cognitoSub = :uid AND attribute_not_exists(refreshToken)",
                    ExpressionAttributeValues: { ":uid": uid },
                }));
            }
            // 墓石から番号を消す（#295: 墓石に残すのは要るものだけ。取り消しが済めば要らない）
            await ddb.send(new UpdateCommand({
                TableName: USERS_TABLE, Key: { userId: uid },
                UpdateExpression: "REMOVE #f",
                ConditionExpression: "attribute_exists(deletedAt) AND #f = :s",
                ExpressionAttributeNames: { "#f": subField(provider) },
                ExpressionAttributeValues: { ":s": sub },
            }));
        } catch (e) {
            if (errName(e) !== "ConditionalCheckFailedException") {
                console.error(`deleteAccount: ${provider} の結び付けを片付けられませんでした（${uid}）:`, errName(e));
            }
        }
    }
    // パスワードを決めた印（`passwordKey`・「サインインの方法」）も消す（退会した人の行を残さない）
    await ddb.send(new DeleteCommand({ TableName: USERS_TABLE, Key: { userId: passwordKey(uid) } }))
        .catch((e) => console.error(`deleteAccount: パスワードの印を片付けられませんでした（${uid}）:`, errName(e)));
}
