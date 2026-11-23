/**
 * 「サインインの方法」（札 journey.photo-ios#601・2026-11-23 owner「設定に『サインインの方法』を足し、Apple と Google を外せるようにする」）。
 *
 * - `GET /user/signin-methods`（ログイン必須）: メールアドレスとパスワード・Apple・Google の、つながっているか・外せるか
 * - `DELETE /user/signin-methods/{provider}`（ログイン必須）: 本人が Apple か Google のつながりを外す。
 *   Apple は更新トークンを取り消してから（`appleRevoke` の関数に頼む・`federatedRevokeClient.ts`）、`apple#<sub>` の行と
 *   プロフィールの `appleSub` を消す。Google は行と `googleSub` を消す（Google の更新トークンは持っていない）
 *
 * 🔴 **最後に残る入り方は外させない。** Apple や Google で新しく作った人（`FEDERATED_SIGNUP_FIELD`）はメールのパスワードを
 *    知らないので、ただ1つの入り方を外すと二度と入れなくなる。その時は 409（`last_signin_method`）で断る。
 *    パスワードを決め直した人（`passwordKey` の行がある）はメールで入れるので外せる。
 *    同時に Apple と Google の両方を外す回が来ても0にならないよう、プロフィールの書き換えの条件で
 *    「ほかの入り方がまだある」を確かめる（読んでから書くまでの隙を作らない）
 * 🔴 外した提供元には、メールが同じでも自動ではもう結ばない（`unlinkedField`・`findLinkableEmailUser`）
 *
 * DB の形は変えない（新しい表・GSI は無い。users 表の行と欄だけ）。
 * 流量は user API の段の経路ごとの設定（`serverless.yml` の `AppleSigninOn`）。
 */
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { ListUsersCommand, type AttributeType } from "@aws-sdk/client-cognito-identity-provider";
import { DeleteCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./dynamodb";
import { requireEnv } from "./env";
import { getUserId, jsonError, JSON_HEADERS } from "./http";
import { isUserId } from "./userId";
import { assertLiveCaller } from "./liveCaller";
import {
    federatedDeps, federatedKey, filterValue, isProvider, linkedSubs, passwordKey, readFederatedRow, subField, unlinkedField,
    FEDERATED_SIGNUP_FIELD, PROVIDERS, type FederatedRow, type Provider, type Revoker,
} from "./federatedAccount";
import { appleRevokeViaStack } from "./federatedRevokeClient";

const USERS_TABLE = requireEnv("USERS_TABLE");

export const LAST_METHOD_MESSAGE = "ほかに入る方法が無いので解除できません。先にメールアドレスとパスワードを設定してください。";
export const NOT_LINKED_MESSAGE = "連携していません";
export const REVOKE_FAILED_MESSAGE = "今は解除できません。少し待ってからお試しください";

/** 外へ話す口（試験で差し替える） */
export const methodsDeps: { revokers: Partial<Record<Provider, Revoker>> } = {
    revokers: { apple: appleRevokeViaStack },
};

export type SigninMethod = {
    id: "email" | Provider;
    linked: boolean;
    /** 「解除」を出してよいか（メールは解除しない） */
    removable: boolean;
    /** 解除できない理由（連携しているのに解除できないときだけ） */
    blockedReason?: string;
    /** メールアドレス（本人の答えだけ・`id: "email"` のときだけ） */
    email?: string;
};

type Profile = Record<string, unknown>;
type State = {
    profile: Profile;
    email?: string;
    /** メールアドレスとパスワードで入れるか */
    emailUsable: boolean;
    /** 本人の行を指している、つながっている提供元 */
    linked: { provider: Provider; sub: string; row: FederatedRow | undefined }[];
};

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? "";
const noStore = (body: unknown) => ({
    statusCode: 200,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store" },
    body: JSON.stringify(body),
});

async function getRow(userId: string): Promise<Profile | undefined> {
    const res = await ddb.send(new GetCommand({ TableName: USERS_TABLE, Key: { userId }, ConsistentRead: true }));
    return res.Item as Profile | undefined;
}

/** Cognito の利用者のメール（sub で探す。ユーザー名は sub と違う） */
async function cognitoEmail(uid: string): Promise<string | undefined> {
    const res = await federatedDeps.idp.send(new ListUsersCommand({
        UserPoolId: federatedDeps.poolId(), Filter: `sub = "${filterValue(uid)}"`, Limit: 1,
    })) as { Users?: { Attributes?: AttributeType[] }[] };
    const email = res.Users?.[0]?.Attributes?.find((a) => a.Name === "email")?.Value;
    return email || undefined;
}

async function loadState(uid: string): Promise<State | null> {
    const profile = await getRow(uid);
    if (!profile || profile.deletedAt !== undefined) return null;
    const linked: State["linked"] = [];
    let createdByProvider = typeof profile[FEDERATED_SIGNUP_FIELD] === "string";
    for (const { provider, sub } of linkedSubs(profile)) {
        const row = await readFederatedRow(provider, sub);
        // 🔴 行が別の人を指していれば、この人のつながりとして数えない
        if (row && row.cognitoSub !== undefined && row.cognitoSub !== uid) continue;
        if (row?.linkedBy === "new") createdByProvider = true;
        linked.push({ provider, sub, row });
    }
    const email = await cognitoEmail(uid);
    const passwordSet = createdByProvider ? (await getRow(passwordKey(uid))) !== undefined : true;
    return { profile, email, emailUsable: !!email && passwordSet, linked };
}

/** ほかに入る方法があるか（`provider` を外したあと） */
const hasOtherMethod = (state: State, provider: Provider) =>
    state.emailUsable || state.linked.some((l) => l.provider !== provider);

export function describeMethods(state: State): SigninMethod[] {
    const email: SigninMethod = { id: "email", linked: state.emailUsable, removable: false, ...(state.email ? { email: state.email } : {}) };
    return [email, ...PROVIDERS.map((provider): SigninMethod => {
        const linked = state.linked.some((l) => l.provider === provider);
        if (!linked) return { id: provider, linked: false, removable: false };
        return hasOtherMethod(state, provider)
            ? { id: provider, linked: true, removable: true }
            : { id: provider, linked: true, removable: false, blockedReason: LAST_METHOD_MESSAGE };
    })];
}

/** `GET /user/signin-methods` */
export const listSigninMethods: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!isUserId(uid)) return jsonError(401, "ログインしてください");
    try {
        const state = await loadState(uid);
        if (!state) return jsonError(404, "見つかりません");
        return noStore({ methods: describeMethods(state) });
    } catch (e) {
        console.error("listSigninMethods:", errName(e));
        return jsonError(500, "読み込めませんでした");
    }
};

/** `DELETE /user/signin-methods/{provider}` */
export const removeSigninMethod: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const uid = getUserId(event);
    if (!isUserId(uid)) return jsonError(401, "ログインしてください");
    const provider = event.pathParameters?.provider;
    if (!isProvider(provider)) return jsonError(400, "不正なリクエスト");
    // 退会した人の残ったトークンでは書かせない（`liveCaller.ts`・書く口は全部これを通る）
    const gone = await assertLiveCaller(uid);
    if (gone) return gone;
    try {
        const state = await loadState(uid);
        if (!state) return jsonError(404, "見つかりません");
        const target = state.linked.find((l) => l.provider === provider);
        if (!target) return jsonError(404, NOT_LINKED_MESSAGE, "not_linked");
        if (!hasOtherMethod(state, provider)) return jsonError(409, LAST_METHOD_MESSAGE, "last_signin_method");

        // 1. 更新トークンを取り消す（Apple の決まり）。届かないときは何も変えずに止める（押し直せば続きから）。
        //    断られた・鍵が無いときは外すのを止めない（本人の意思を優先。見張りに出す。退会と同じ考え・`revokeLinkedTokens`）
        const row = target.row;
        if (row && typeof row.refreshToken === "string") {
            const revoker = methodsDeps.revokers[provider];
            const result = revoker ? await revoker(row.refreshToken) : "unavailable";
            if (result === "failed") return jsonError(503, REVOKE_FAILED_MESSAGE, "revoke_failed");
            if (result !== "revoked") console.error(`removeSigninMethod: ${provider} の更新トークンを取り消せませんでした（${result}）。外すのは進める`);
        }

        // 2. プロフィールから番号を消す。🔴 条件で「ほかに入る方法がまだある」を確かめる（同時に2つ外す回で0にしない）
        const others = state.linked.filter((l) => l.provider !== provider);
        const names: Record<string, string> = { "#f": subField(provider), "#u": unlinkedField(provider) };
        const values: Record<string, unknown> = { ":s": target.sub, ":at": new Date(federatedDeps.now()).toISOString() };
        let cond = "#f = :s AND attribute_not_exists(deletedAt)";
        if (!state.emailUsable) {
            others.forEach((o, i) => { names[`#o${i}`] = subField(o.provider); });
            cond += ` AND (${others.map((_, i) => `attribute_exists(#o${i})`).join(" OR ")})`;
        }
        let update = "SET #u = :at";
        if (row?.linkedBy === "new") {
            // この提供元で作った人。行を消すと分からなくなるので、プロフィールに残す（メールのパスワードを持たない印）
            names["#g"] = FEDERATED_SIGNUP_FIELD;
            values[":p"] = provider;
            update += ", #g = if_not_exists(#g, :p)";
        }
        try {
            await ddb.send(new UpdateCommand({
                TableName: USERS_TABLE, Key: { userId: uid },
                UpdateExpression: `${update} REMOVE #f`,
                ConditionExpression: cond,
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
            }));
        } catch (e) {
            if (errName(e) !== "ConditionalCheckFailedException") throw e;
            return jsonError(409, LAST_METHOD_MESSAGE, "last_signin_method");
        }

        // 3. つながりの行を消す（本人の行だけ）
        await ddb.send(new DeleteCommand({
            TableName: USERS_TABLE, Key: { userId: federatedKey(provider, target.sub) },
            ConditionExpression: "cognitoSub = :uid",
            ExpressionAttributeValues: { ":uid": uid },
        })).catch((e) => { if (errName(e) !== "ConditionalCheckFailedException") throw e; });

        console.log(JSON.stringify({ metric: "federated_unlink", provider }));
        const after = await loadState(uid);
        return noStore({ methods: after ? describeMethods(after) : [] });
    } catch (e) {
        console.error("removeSigninMethod:", errName(e));
        return jsonError(500, "解除できませんでした。少し待ってからお試しください");
    }
};
