import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { getUserId, jsonError, JSON_HEADERS, type AuthedEvent } from "./http";
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { assertLiveCaller } from "./liveCaller";

/**
 * プッシュ通知の宛先（端末のトークン）。
 *
 * **1人1行に集める**（`devices#<uid>`）。通知を送るのは「誰かの行動 →
 * 相手の端末」で、相手の端末を**1回の GetItem で全部**引きたいから
 * ——索引を足して Query するより安く、`notifs#<uid>` と同じ形に揃う。
 *
 * **DynamoDB の Set に入れる。** `ADD`／`DELETE` はアトミックで、
 * 同じトークンを二度足しても増えない。配列で持つと「読んで足して書く」に
 * なり、2台の端末がほぼ同時に登録すると片方が消える
 * （`notify.ts` の切り詰めが同じ形で一度踏んでいる）。
 */
export const devicesId = (uid: string) => `devices#${uid}`;
/**
 * 🔴 **トークン → いま持っている人**。1台につき1行。
 *
 * これが無いと、**同じ端末を別の人が使ったときに通知が他人へ届く**:
 *
 *   1. A がログイン → `devices#A` にトークン T が入る
 *   2. `DELETE /user/devices` を呼べないままログアウト（強制ログアウト・
 *      クラッシュ・アプリ削除・通信断）。解除は端末側からしか呼べない
 *   3. 同じ端末で B がログイン → `devices#B` にも T が入る
 *   4. A にいいねが来ると、`deliverPush` が `devices#A` から T を引いて送る
 *      → **B の端末に A 宛ての通知（行動した人の名前）とバッジが出る**
 *
 * APNs は T を有効なトークンとして 200 を返すので、**410 では絶対に
 * 消えない**（`isDeadToken` が正しく働いているのに救えない形）。
 * 退会時の掃除（`account.ts`）が塞ぐのは「本人が退会した場合」だけ。
 *
 * だから**登録のたびに持ち主を書き換え、前の持ち主から外す**。
 */
export const deviceOwnerId = (token: string) => `devicetoken#${token}`;

/**
 * 1人が持てる端末の数。
 *
 * **際限なく増やさない。** アプリは起動のたびに登録するので、端末を
 * 買い替え続けると古いトークンが積もる。APNs は無効なトークンを 410 で
 * 教えてくれるが、それは**送ってみて初めて**分かる——送る相手が増えるほど
 * 1回の通知が重くなる。
 *
 * **「古い順に落とす」はできない**（Set に順番は無い）。落とすのは
 * 「いま登録した1台以外から溢れたぶん」で、無効なものは 410 で自然に消える。
 */
export const DEVICES_MAX = 10;

/** APNs のトークンは16進。長さは機種と OS で変わるので幅で見る */
export function isDeviceToken(v: unknown): v is string {
    return typeof v === "string" && /^[0-9a-f]{32,200}$/i.test(v.trim());
}

/**
 * 保存する形に揃える。**小文字に畳む。**
 *
 * 16進なので `AB…` と `ab…` は同じ端末だが、**DynamoDB の Set では別の
 * メンバー**になる。畳まないと同じ端末が2枠（`DEVICES_MAX` の 10 のうち2つ）を
 * 占め、通知が二重に届き、片方の綴りで解除しても他方が残る。APNs は
 * どちらの綴りも受けるので 410 では消えない。
 */
export const normalizeDeviceToken = (v: string) => v.trim().toLowerCase();

/**
 * 端末のアプリが持っている通知の文言の段（`POST /user/devices` の `pushKeys`・2026-11-15 札 #618）。
 *
 * 端末の通知の文は、サーバーが送る鍵（`NOTIF_COMMENT_REPLY` など）をアプリの `Localizable.strings` で
 * 引いて出す。**鍵を持たない古いアプリは、鍵の文字列そのものを通知に出す**（`notify.ts` の `LOC_KEYS`）。
 * App Store の 1.0.87（2026-10-11）は `NOTIF_LIKE`・`NOTIF_COMMENT`・`NOTIF_FOLLOW`・
 * `NOTIF_STORY_REPLY`・`NOTIF_BADGE` しか持っていない（2026-11-15 に `testflight/1.0.87` の
 * `Localizable.strings` で確かめた）。
 *
 * - 段 2: 2026-11-11 の鍵（`NOTIF_COMMENT_REPLY`・`NOTIF_STORY_MENTION`・`NOTIF_STORY_SHARE`）を持つ。
 *   アプリは 1.1.82 から鍵を持つが、`pushKeys` を送るのは札 #618 の版から
 * - 送らない古いアプリは段 1。段 2 の種類はその端末には送らない（一覧には積むので、開けば見える）
 *
 * 2026-11-15 判断: **持ち主の行（`devices#<uid>`）に、段 2 の端末だけの Set（`keys2Tokens`）を足す。**
 * 新しい表・索引・行は作らない。登録の書き込み（`ADD #tokens`）と同じ1回に `ADD` を足すだけで、
 * 送る側も今と同じ1回の GetItem で読む（読み書きの回数は増えない）
 */
export const PUSH_KEYS_LATEST = 2;
const KEYS2_ATTR = "keys2Tokens";

/** Set か配列を文字列の配列に（lib-dynamodb は DynamoDB の Set を JS の Set にして返す） */
function stringsOf(v: unknown): string[] {
    if (v instanceof Set) return [...v].map(String);
    return Array.isArray(v) ? v.map(String) : [];
}

/** 持ち主の行を読む。`tokens` と、段 2 の端末（`keys2Tokens`） */
async function deviceRow(uid: string, consistent: boolean): Promise<{ tokens: string[]; keys2: Set<string> }> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: devicesId(uid) },
        ProjectionExpression: "#tokens, #k2",
        ExpressionAttributeNames: { "#tokens": "tokens", "#k2": KEYS2_ATTR },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    return { tokens: stringsOf(res.Item?.tokens), keys2: new Set(stringsOf(res.Item?.[KEYS2_ATTR])) };
}

/**
 * その人の端末トークン。引けなければ空（通知が飛ばないだけ）。
 *
 * `minPushKeys` が 2 なら、**段 2 の鍵を持つアプリの端末だけ**（`PUSH_KEYS_LATEST` の注記）。
 * 古いアプリの端末に、鍵の文字列がそのまま出る通知を送らないため
 */
export async function deviceTokens(uid: string, consistent = false, minPushKeys = 1): Promise<string[]> {
    try {
        const row = await deviceRow(uid, consistent);
        return minPushKeys >= 2 ? row.tokens.filter((t) => row.keys2.has(t)) : row.tokens;
    } catch (e) {
        console.error(`deviceTokens: 端末を引けませんでした（${uid}）:`, e);
        return [];
    }
}

/**
 * 無効になったトークンを外す。
 *
 * **APNs が 410 を返したときにだけ呼ぶ。** 送信の失敗で外すと、
 * 一時的な不通で宛先を失う（次からは通知が届かないのに誰も気づけない）。
 */
export async function forgetTokens(uid: string, tokens: readonly string[]): Promise<void> {
    const dead = tokens.filter(isDeviceToken);
    if (dead.length === 0) return;
    try {
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: devicesId(uid) },
            UpdateExpression: "DELETE #tokens :dead",
            ExpressionAttributeNames: { "#tokens": "tokens" },
            ExpressionAttributeValues: { ":dead": new Set(dead) },
        }));
    } catch (e) {
        console.error(`forgetTokens: 外せませんでした（${uid}）:`, e);
    }
}

/** 端末を登録する。`POST /user/devices` */
export const registerDevice: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event as AuthedEvent);
    if (!userId) return jsonError(401, "認証が必要です");
    // 退会した本人（期限内のトークン）に書かせない（`liveCaller.ts`）
    const gone = await assertLiveCaller(userId);
    if (gone) return gone;

    let body: { token?: unknown; pushKeys?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const token = typeof body.token === "string" ? normalizeDeviceToken(body.token) : "";
    if (!isDeviceToken(token)) return jsonError(400, "端末のトークンが不正です");
    // 文言の段（`PUSH_KEYS_LATEST`）。数でなければ段 1（古いアプリは送らない）
    const keys2 = typeof body.pushKeys === "number" && body.pushKeys >= 2;

    try {
        // **先に前の持ち主から外す。** 逆引きの行を自分に書き換え、
        // 返ってきた古い値が別人なら、その人の集合から T を落とす。
        //
        // **順番はこちらが先。** あとにすると、外す前に相手へ通知が飛ぶ窓が
        // 残る（`ADD` は即座に効く）。逆に先に外して登録が落ちた場合は
        // 「誰にも届かない」で止まるので、倒れる向きが安全
        await releasePreviousOwner(token, userId);
        await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: devicesId(userId) },
            // 段 2 のアプリなら、同じ書き込みで `keys2Tokens` にも足す（書き込みの回数は増えない）
            UpdateExpression: keys2
                ? "ADD #tokens :token, #k2 :token SET uid = :uid, updatedAt = :now"
                : "ADD #tokens :token SET uid = :uid, updatedAt = :now",
            ExpressionAttributeNames: { "#tokens": "tokens", ...(keys2 ? { "#k2": KEYS2_ATTR } : {}) },
            ExpressionAttributeValues: {
                ":token": new Set([token]),
                ":uid": userId,
                ":now": new Date().toISOString(),
            },
        }));
        // **溢れたら古い方を落とす。** 落とせなくても登録は成功で返す
        // （送る側が重くなるだけで、通知は届く）
        await trimTokens(userId, token, keys2);
    } catch (e) {
        console.error(`registerDevice error（${userId}）:`, e);
        return jsonError(500, "登録できませんでした");
    }
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};

/**
 * 上限を超えたぶんを落とす。**いま登録した1台は必ず残す。**
 *
 * Set には順番が無いので「古い順」は分からない。落とす相手を選べない以上、
 * **今の1台を残して、残りから溢れたぶんを外す**のが唯一安全な形
 * （無効なトークンは APNs の 410 で自然に消えていく）。
 */
async function trimTokens(uid: string, keep: string, keepIsKeys2: boolean): Promise<void> {
    // **強整合で読む。** いま `ADD` した1台が見えない読みが返ると件数が
    // 1少なく見えて切り詰めが飛ぶ／2台がほぼ同時に登録すると同じ古い
    // 断面から各々 `extra` を計算して 10 未満まで削る
    const row = await deviceRow(uid, true);
    const { tokens } = row;
    const extra = tokens.length <= DEVICES_MAX ? []
        : tokens.filter((t) => t !== keep).slice(0, tokens.length - DEVICES_MAX);
    if (extra.length > 0) await forgetTokens(uid, extra);
    // 段 2 の印の掃除（2026-11-15 札 #618）。**印が実際に在るときだけ** DELETE を書く
    // （無い行に書きに行かない＝古いアプリの登録で書き込みを増やさない）:
    //   - 同じ端末に古いアプリを入れ直した（段 1 で登録し直した）→ その端末を印から外す
    //   - `tokens` から外れた端末（410・溢れ・別の人へ移った）の印 → 外す（印が際限なく残らない）
    const alive = new Set(tokens.filter((t) => !extra.includes(t)));
    const stale = [...row.keys2].filter((t) => !alive.has(t) || (t === keep && !keepIsKeys2));
    if (stale.length === 0) return;
    await ddb.send(new UpdateCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: devicesId(uid) },
        UpdateExpression: "DELETE #k2 :stale",
        ExpressionAttributeNames: { "#k2": KEYS2_ATTR },
        ExpressionAttributeValues: { ":stale": new Set(stale) },
    })).catch((e) => console.error(`trimTokens: 段 2 の印を外せませんでした（${uid}）:`, e));
}

/**
 * この端末の持ち主を `userId` にし、**前の持ち主から外す**。
 *
 * 書き込みは1回（`ALL_OLD` で古い値が返る）。前の持ち主が同じ人なら何もしない。
 * **失敗しても登録は続ける**——ここで止めると通知が1つも届かなくなるが、
 * 通した場合の最悪は「前の人の端末にも届く」で、次の登録で直る。
 * ただし**黙って飲まない**（記録は残す）。
 */
async function releasePreviousOwner(token: string, userId: string): Promise<void> {
    try {
        const res = await ddb.send(new UpdateCommand({
            TableName: PHOTOS_TABLE,
            Key: { id: deviceOwnerId(token) },
            UpdateExpression: "SET uid = :uid, updatedAt = :now",
            ExpressionAttributeValues: { ":uid": userId, ":now": new Date().toISOString() },
            ReturnValues: "ALL_OLD",
        }));
        const previous = res.Attributes?.uid;
        if (typeof previous === "string" && previous && previous !== userId) {
            await forgetTokens(previous, [token]);
        }
    } catch (e) {
        console.error(`releasePreviousOwner: 前の持ち主を外せませんでした（${token.slice(0, 8)}…）:`, e);
    }
}

/** 端末を外す（ログアウト・通知オフ）。`DELETE /user/devices` */
export const unregisterDevice: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event as AuthedEvent);
    if (!userId) return jsonError(401, "認証が必要です");

    let body: { token?: unknown };
    try {
        body = JSON.parse(event.body ?? "{}") as typeof body;
    } catch {
        return jsonError(400, "不正なリクエスト");
    }
    const token = typeof body.token === "string" ? normalizeDeviceToken(body.token) : "";
    // **無いトークンを外せと言われても 200。** ログアウトの後始末なので、
    // ここで止めると「ログアウトできない」になる
    if (!isDeviceToken(token)) {
        return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
    }
    await forgetTokens(userId, [token]);
    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ ok: true }) };
};
