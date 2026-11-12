import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import { randomUUID } from "crypto";
import { JSON_HEADERS, getUserId, jsonError } from "./http";
import { GetCommand, BatchGetCommand, DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";
import { updateUserList, updateUserRow, readUserRows, readUserList, UserListError } from "./userList";
import { sanitizeText, sanitizeSpotId } from "./sanitize";
import { assertLiveCaller } from "./liveCaller";
import { inviteKey, isValidInviteToken } from "./invite";
import { tripChatKey, appendTripChat, addedMessages } from "./tripChat";

/**
 * 旅行プラン——**行きたい場所を「いつ・どの順で回るか」に並べる**口。
 *
 * 計画書（`docs/journey-photo-plan-2026-09-23.md` 第12章）が決めた形を、
 * そのまま実装する。**足していないもの**もあちらが名指ししている:
 * 移動時間・費用・経路最適化・AI 生成・予約は**作らない**
 * （計算していない数字を出さない、が理由）。
 *
 * ## 入れ物は `spots#<uid>` / `likes#<uid>` と同じ「利用者ごとの1行」
 *
 * このテーブルにソートキーは無いので `trip#<planId>#<uid>` のような行を
 * 前方一致で列挙できない（全表 Scan しか手が無い）。だから
 * `userList.ts` の `updateUserList`（新しい順のリスト1行 ＋ `rev` の CAS）を
 * そのまま使う。**GSI は要らない。**
 *
 * 中身が文字列ではなくオブジェクトなので、`updateUserList` を型引数つきに
 * 広げ、読む側は `readUserRows` を足した——**2つ目の実装は作らない**
 * （`userList.ts` 自身が「規則を2つ書くと静かにずれる」と書いている）。
 *
 * ## 他人のプランは読めない
 *
 * 行 ID は **JWT の `sub` からしか作らない**（`tripsId(getUserId(event))`）。
 * パスにもクエリにも本文にも「誰のプランか」を受け取る口を持たない。
 * `visibility` も**受け取らない**——`"private"` を書き込むだけ。公開できる
 * ようにするかは別の判断で、受け取る口を先に開けておくと、画面が付く前に
 * 「本文に `visibility: "public"` を書けば公開になる」状態が生まれる。
 *
 * ## 上限は「黙って落とす」ではなく「断る」
 *
 * いいね・フォローの一覧は溢れたぶんを古い方から落としてよい（判定は
 * マーカーが持つ・表示用の索引だから）。**プランは利用者自身が書いた
 * 中身で、落ちたら戻せない。** だから `updateUserList` の `max` に任せず、
 * 中で数えて**断る**（`highlights.ts` が同じ形で 403 を返している）。
 *
 * ## 行の大きさも先に見る（**構造の上限だけでは足りない**）
 *
 * DynamoDB の1項目は 400KB。最初は「1人50プラン・1プラン60日・1日30項目」
 * だけを上限にしていたが、**その積は行の予算をはるかに超える**。実測:
 *
 *     項目1つ（スラッグ200B ＋ ひとこと200字）  839 バイト
 *     60日 × 30項目 ＝ 1,800項目                **1,475 KB**  ← 1プランで超える
 *     行の予算                                     350 KB
 *
 * ＝**上限いっぱいまで書いたプランは1つも保存できない**。しかも断り文は
 * 「これ以上は保存できません」だけなので、**どの上限に当たったのか分からない**。
 * テストを書いて初めて出た（`日数・1日の項目数・ひとことを上限で切る` が
 * 403 で落ちた）。
 *
 * だから天井を2段にする:
 *
 *   1プランごと  `TRIP_PLAN_BUDGET_BYTES`  … 「この旅程はこれ以上増やせません」
 *   行ぜんぶ      `TRIPS_BUDGET_BYTES`      … 「プランを減らしてください」
 *
 * **構造の上限（日数・項目数・字数）は目安**で、本当の天井はバイト数。
 * 構造の上限を残すのは、1回の要求で処理する量を抑えるためと、
 * 断る理由を具体的に言うため。
 *
 * `comments.ts` が同じ理由で `overBudgetCount` を持っているが、あちらは
 * 古い方から落とす。**ここは断る**（上と同じ——利用者が書いた中身だから）。
 */

/** 旅行プランの一覧（`trips#<uid>`）。新しい順 */
const tripsId = (uid: string) => `trips#${uid}`;

/** 1人が持てるプランの数。**超えたら断る**（古い方を落とさない） */
export const TRIPS_MAX = 50;
/** プランの題 */
export const TRIP_TITLE_MAX = 100;
/** 1プランの日数。2か月の旅まで */
export const TRIP_DAYS_MAX = 60;
/** 1日に置ける項目。1日20か所は実際の旅より十分多い */
export const TRIP_ITEMS_PER_DAY_MAX = 20;
/** 項目に添えるひとこと */
export const TRIP_NOTE_MAX = 200;
/**
 * 行1つの予算（バイト）。400KB に対して 50KB の余白
 * （`id`・`uid`・`rev`・`updatedAt` と、DynamoDB が属性名ぶんに使う分）。
 * `comments.ts` の `ITEM_BUDGET_BYTES` と同じ取り方。
 */
export const TRIPS_BUDGET_BYTES = 350 * 1024;
/**
 * **1プランの予算**（バイト）。
 *
 * 数え方（実測・2026-09-24）:
 *
 *     項目1つ  ひとこと無し・短いスラッグ      30 B
 *              スラッグ200B ＋ ひとこと200字  839 B
 *     60日 × 20項目 ＝ 1,200項目  素で 35 KB ／ 全部最大なら 983 KB
 *
 * ＝**構造の上限まで置いても、ふつうに書くぶんには 35KB で収まる**。
 * 128KB はそこに3倍以上の余裕を見た値で、**ひとことを全部の項目に
 * 200字ずつ書いた場合だけ**当たる（そのときは「この旅程は…」と断る）。
 *
 * 行の予算（350KB）より大きいのは意図的——「1つを大きく」と
 * 「たくさん並べる」で当たる天井を分け、断り文を言い分けるため。
 */
export const TRIP_PLAN_BUDGET_BYTES = 128 * 1024;

/**
 * 撮影スポットの ID の形（`content/spots.json` の `spotId`）。
 *
 * **実在は確かめない。** 台帳は `content/` の JSON で、Lambda に持ち込むと
 * 全文がバンドルに乗る（`lib/data/spotLink.ts` が同じ理由でクライアントから
 * 外している）。`savedSpots.ts` がスラッグの**形**しか見ないのと同じ立場
 * ——実在しない ID を入れても、画面が出すときに解けずに落ちるだけ。
 */
const isSpotId = (x: string) => sanitizeSpotId(x) === x;

/** 撮影地スラッグの上限（**バイト**）。`savedSpots.ts` と同じ理由・同じ値 */
const MAX_SLUG_BYTES = 200;
const isLocationSlug = (x: string) =>
    x.length > 0 && !x.includes("#") && Buffer.byteLength(x, "utf8") <= MAX_SLUG_BYTES;

/**
 * 旅の日付。**`sanitize.ts` の `sanitizeDate` は使えない。**
 *
 * あちらは**撮影日**用で「1990年より前」と「未来」を捨てる。旅行プランは
 * **これから行く日**を書くものなので、未来を捨てると使えない。
 * 受けるのは `YYYY-MM-DD` だけ（計画書が「ISO の日付だけ」と決めている）。
 * 実在しない日（2月30日）も弾く——`Date` は繰り上げて通してしまう。
 */
export function sanitizeTripDate(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const s = v.trim();
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return undefined;
    /**
     * **書き戻して一致するものだけ通す。** これが形の検査も兼ねる
     * ——`toISOString()` が返すのは必ず `YYYY-MM-DD...` なので、
     * 一致するなら `s` は `YYYY-MM-DD` そのもの。繰り上がり
     * （`2024-02-30` → 3/1）も、`2026/05/01` のような別の書き方も、
     * ここで落ちる。
     *
     * ⚠️ **`/^\d{4}-\d{2}-\d{2}$/` を先に置いていたが、外しても
     * 14通りの入力で答えが1つも変わらなかった**（実測）。上の理由で
     * 論理的にも冗長なので落とした（`bf3df612`「二重の守りは1本にする」）。
     * 足し直さないこと——足すと、この行を壊す変異が観測できなくなる。
     */
    return d.toISOString().slice(0, 10) === s ? s : undefined;
}

export type TripItem =
    | { kind: "spot"; spotId: string; note?: string; by?: string }
    | { kind: "location"; slug: string; note?: string; by?: string };

export type TripDay = { date?: string; items: TripItem[] };

export type TripPlan = {
    /** **題から作らない**（改名で別物になる・他人が当てられる）。`spots.ts` と同じ判断 */
    planId: string;
    ownerId: string;
    title: string;
    startDate?: string;
    endDate?: string;
    days: TripDay[];
    /** **いまは非公開だけ**。受け取らず、ここが書く */
    visibility: "private";
    createdAt: string;
    updatedAt: string;
};

/**
 * `updateUserList` に**切らせない**ための値。
 *
 * あちらの `max` は「溢れたぶんを古い方から落とす」ための枠で、いいね・
 * フォローの一覧にはそれが正しい（判定はマーカーが持つ・索引だから）。
 * ここで `TRIPS_MAX` を渡すと、**上限を後から下げた日に、消す操作ひとつで
 * 溢れているぶんのプランが黙って消える**——利用者が書いた中身なので
 * 戻せない。数を見るのは `mutate` の1か所だけにする。
 */
const NO_TRUNCATE = Number.MAX_SAFE_INTEGER;

/** 上限を超えたときに一覧の書き込みから抜ける印（`updateUserList` は CCF 以外を素通しする） */
class TripLimitError extends Error {
    constructor(readonly reason: string) { super(reason); }
}

/** 保存されている行として通してよい形（読むとき・消すとき） */
export function isStoredTripPlan(x: unknown): x is TripPlan {
    if (typeof x !== "object" || x === null) return false;
    const p = x as Partial<TripPlan>;
    // **`days` の中までは見ない。** 上限を後から狭めたときに、
    // 既に入っているプランが「読めない／消せない」になる（`savedSpots.ts` の
    // 「長さを見ない」と同じ三すくみ）。形の芯だけ見る
    return typeof p.planId === "string" && p.planId.length > 0
        && typeof p.title === "string"
        && Array.isArray(p.days);
}

/** 受け取った項目を、保存してよい形に均す。読めなければ `null`（その項目だけ落とす） */
function sanitizeItem(raw: unknown): TripItem | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as { kind?: unknown; spotId?: unknown; slug?: unknown; note?: unknown };
    const note = sanitizeText(r.note, TRIP_NOTE_MAX);
    if (r.kind === "spot") {
        const spotId = typeof r.spotId === "string" ? r.spotId.trim() : "";
        if (!isSpotId(spotId)) return null;
        return note ? { kind: "spot", spotId, note } : { kind: "spot", spotId };
    }
    if (r.kind === "location") {
        const slug = typeof r.slug === "string" ? r.slug.trim() : "";
        if (!isLocationSlug(slug)) return null;
        return note ? { kind: "location", slug, note } : { kind: "location", slug };
    }
    // **知らない種別は落とす。** 通すと、画面が描けない項目が枠を食ったまま残る
    return null;
}

/** 受け取った日ごとの並びを均す（共有したプラン `tripShare.ts` も同じ規則で均す） */
export function sanitizeDays(raw: unknown): TripDay[] {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, TRIP_DAYS_MAX).map((d) => {
        const rd = (typeof d === "object" && d !== null ? d : {}) as { date?: unknown; items?: unknown };
        const items = Array.isArray(rd.items)
            ? rd.items.map(sanitizeItem).filter((x): x is TripItem => x !== null).slice(0, TRIP_ITEMS_PER_DAY_MAX)
            : [];
        const date = sanitizeTripDate(rd.date);
        return date ? { date, items } : { items };
    });
}

/** 行ぜんぶの予算に収まるか。**足す前に見る**（入らない行を作らない） */
export function fitsBudget(list: readonly TripPlan[]): boolean {
    return Buffer.byteLength(JSON.stringify(list), "utf8") <= TRIPS_BUDGET_BYTES;
}

/** 1プランの予算に収まるか。**先にこちらを見る**（断る理由を具体的にするため） */
export function fitsPlanBudget(plan: TripPlan): boolean {
    return Buffer.byteLength(JSON.stringify(plan), "utf8") <= TRIP_PLAN_BUDGET_BYTES;
}

/** 断り文。**どちらの天井に当たったかを言い分ける** */
export const PLAN_TOO_BIG = "この旅程はこれ以上増やせません。項目かひとことを減らしてください";
const ROW_TOO_BIG = "これ以上は保存できません。使わないプランを消してください";

/**
 * GET /user/trips — 自分の旅行プラン（新しい順）。
 *
 * **中身をそのまま返す。** スポットの名前・写真は画面が既に持っている
 * 台帳（`content/spots.json`）から解く（`getMySavedSpots` が
 * 「スラッグだけ返す」としているのと同じ立場）。
 */
export const getMyTrips: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    try {
        // 共有したプラン（`trip#<planId>`・2026-11-12）も合わせて返す。**読めなければ 500**
        // ——共有のぶんだけ黙って欠けた一覧を返すと、画面が「消えた」と見せる
        const [plans, shared] = await Promise.all([
            readUserRows(tripsId(userId), isStoredTripPlan, `trips#${userId}`),
            listSharedTrips(userId),
        ]);
        return {
            statusCode: 200,
            // **本人だけの答え。共有キャッシュには載せない**
            headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
            body: JSON.stringify({ plans: mergeTrips(plans, shared) }),
        };
    } catch (e) {
        console.error("getMyTrips error:", e);
        return jsonError(500, "取得に失敗しました");
    }
};

/** 本文を読む。壊れていれば `null` */
export function parseBody(event: { body?: string | null }): Record<string, unknown> | null {
    try {
        const v = JSON.parse(event.body ?? "{}") as unknown;
        return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/** POST /user/trips — プランを作る */
export const createTrip: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    // 退会した本人（期限内のトークン）に書かせない（`liveCaller.ts`）
    const gone = await assertLiveCaller(userId);
    if (gone) return gone;
    const body = parseBody(event);
    if (!body) return jsonError(400, "不正なリクエスト");

    const title = sanitizeText(body.title, TRIP_TITLE_MAX);
    if (!title) return jsonError(400, "タイトルを入力してください");

    const now = new Date().toISOString();
    const plan: TripPlan = {
        planId: randomUUID(),
        ownerId: userId,
        title,
        ...dateFields(body),
        days: sanitizeDays(body.days),
        visibility: "private",
        createdAt: now,
        updatedAt: now,
    };

    return writeTrips(userId, "作成に失敗しました", (list) => {
        if (list.length >= TRIPS_MAX) {
            throw new TripLimitError(`旅行プランは${TRIPS_MAX}個までです。使わないものを消してください`);
        }
        if (!fitsPlanBudget(plan)) throw new TripLimitError(PLAN_TOO_BIG);
        const next = [plan, ...list];
        if (!fitsBudget(next)) throw new TripLimitError(ROW_TOO_BIG);
        return next;
    });
};

/**
 * PUT /user/trips/{planId} — プランを置き換える。
 *
 * **送られた項目だけを差し替える**（`/user/edit` と同じ）。`days` を
 * 送らなければ日程は触らない——全置換にすると、題だけ直す画面が
 * 日程を丸ごと消しうる。
 */
export const updateTrip: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    // 退会した本人（期限内のトークン）に書かせない（`liveCaller.ts`）
    const gone = await assertLiveCaller(userId);
    if (gone) return gone;
    const planId = event.pathParameters?.planId ?? "";
    if (!planId) return jsonError(400, "プランの指定が不正です");
    const body = parseBody(event);
    if (!body) return jsonError(400, "不正なリクエスト");

    // **題は「送ってきたのに読めない」を黙って通さない。**
    // 送っていない（`undefined`）ときだけ触らない
    if ("title" in body && !sanitizeText(body.title, TRIP_TITLE_MAX)) {
        return jsonError(400, "タイトルを入力してください");
    }

    // **共有の行（`trip#<planId>`）があれば、共有の方を直す**（2026-11-12 確かめ役の見直し3）。共有する途中で
    // 落ちると本人だけの一覧にも古い写しが残り、先に本人だけの方を見ていたので、読む口が採る共有の方が直らなかった。
    // 持ち主が直したら古い写しを片付けて、共有を終わらせる（`shareTrip` の続き）
    if (isPlanId(planId)) {
        try {
            const shared = await readSharedTrip(planId, true);
            if (shared && isTripMember(shared, userId)) {
                const r = await updateSharedTrip(userId, planId, body);
                if (r.kind === "ok" && shared.ownerId === userId) await dropOwnCopy(userId, planId);
                return await sharedWriteResponse(userId, r);
            }
        } catch (e) {
            if (e instanceof UserListError) return jsonError(503, "混み合っています。もう一度お試しください");
            console.error("updateTrip(shared) error:", (e as { name?: string })?.name);
            return jsonError(500, "保存に失敗しました");
        }
    }

    // **やり直し（CCF）のたびに見直す。** 立てっぱなしにすると、1回目に
    // 在って2回目に消えたプランへ 200 を返す
    let found = false;
    const res = await writeTrips(userId, "保存に失敗しました", (list) => {
        const i = list.findIndex((p) => p.planId === planId);
        if (i < 0) { found = false; return null; }
        found = true;
        const prev = list[i];
        const next: TripPlan = {
            ...prev,
            ...( "title" in body ? { title: sanitizeText(body.title, TRIP_TITLE_MAX)! } : {}),
            ...dateFields(body, prev),
            ...( "days" in body ? { days: sanitizeDays(body.days) } : {}),
            // **持ち主と公開範囲は本文から動かさない**
            ownerId: prev.ownerId ?? userId,
            visibility: "private",
            updatedAt: new Date().toISOString(),
        };
        if (!fitsPlanBudget(next)) throw new TripLimitError(PLAN_TOO_BIG);
        const after = [...list];
        after[i] = next;
        if (!fitsBudget(after)) throw new TripLimitError(ROW_TOO_BIG);
        return after;
    });
    if (found) return res;
    // 共有したプランで仲間でない人・無い ID（共有の行は上で先に見た）
    // **無い ID に 200 を返さない。** 返すと、消えたプランを直したつもりの
    // 画面が「保存しました」と出す
    return jsonError(404, "プランが見つかりません");
};

/** DELETE /user/trips/{planId} — プランを消す（冪等） */
export const deleteTrip: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (event) => {
    const userId = getUserId(event);
    if (!userId) return jsonError(400, "不正なリクエスト");
    const planId = event.pathParameters?.planId ?? "";
    if (!planId) return jsonError(400, "プランの指定が不正です");

    let inOwn = false;
    const res = await writeTrips(userId, "削除に失敗しました", (list) => {
        const next = list.filter((p) => p.planId !== planId);
        inOwn = next.length !== list.length;
        // 既に無ければ書かない（冪等）
        return inOwn ? next : null;
    });
    if (!isPlanId(planId) || res.statusCode !== 200) return res;
    // 共有したプラン: **持ち主なら全員のプランを消す。仲間なら抜ける**（2026-11-12）。
    // 本人だけの一覧から消したあとも見る（2026-11-12 確かめ役の見直し3: 共有する途中で両方に在ると、本人だけの
    // 写しだけを消して共有の行が残り、一覧の口に出続けた）
    try {
        const shared = await readSharedTrip(planId, true);
        if (!shared || !isTripMember(shared, userId)) return res;
        if (shared.ownerId === userId) await deleteSharedTripRows(planId);
        else await removeTripMember(planId, userId);
        return await listResponse(userId, await readUserRows(tripsId(userId), isStoredTripPlan, `trips#${userId}`, true));
    } catch (e) {
        console.error("deleteTrip(shared) error:", (e as { name?: string })?.name);
        return jsonError(500, "削除に失敗しました");
    }
};

/** 本人だけの一覧から、共有へ移ったプランの古い写しを外す（`shareTrip` の最後の段と同じ） */
async function dropOwnCopy(uid: string, planId: string): Promise<void> {
    await updateUserList<TripPlan>(tripsId(uid), uid, NO_TRUNCATE, (list) => {
        const next = list.filter((p) => !(isStoredTripPlan(p) && p.planId === planId));
        return next.length === list.length ? null : next;
    });
}

/**
 * 書いたあとの一覧の応答（本人だけ＋共有）。**共有のぶんが読めなかったら `sharedFailed: true`** を添えて
 * 本人のぶんだけ返す——書き込みは通っているので 500 にはしない。画面は前に見えていた共有のプランを残す
 */
async function listResponse(userId: string, own: TripPlan[]) {
    let shared: SharedTrip[] = [];
    let sharedFailed = false;
    try {
        shared = await listSharedTrips(userId);
    } catch (e) {
        console.error(`listResponse: 共有したプランを読めませんでした（${userId}）:`, (e as { name?: string })?.name);
        sharedFailed = true;
    }
    return {
        statusCode: 200,
        headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
        body: JSON.stringify({ plans: mergeTrips(own, shared), ...(sharedFailed ? { sharedFailed: true } : {}) }),
    };
}

/** 共有したプランの書き込みの結果を応答に（`PUT /user/trips/{planId}` と `PUT /trip-share/{planId}` で同じ） */
export async function sharedWriteResponse(userId: string, r: SharedWrite) {
    switch (r.kind) {
        case "notfound": return jsonError(404, "プランが見つかりません");
        case "badTitle": return jsonError(400, "タイトルを入力してください");
        case "limit": return jsonError(403, r.reason);
        case "revRequired":
            // **rev を送らない古いアプリは、読み直しても同じ断りになる**（2026-11-12 確かめ役の見直し1）。
            // 「読み直してください」と言わず、アプリを新しくすれば直せることを言う。古いアプリ（main の iOS）は
            // 409 の本文（`error`）を日本語の画面にそのまま出す（`APIError.description` の `displayableServerText`）。
            // 新しいアプリは 409 を読み直して版を添えて送り直す（`TripAutosave.afterSave`）。今の姿も添える
            return {
                statusCode: 409,
                headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
                body: JSON.stringify({
                    error: "このプランは仲間と共有しています。アプリを新しくすると日程を直せます（題と日付はこのまま直せます）",
                    code: "revRequired",
                    plan: sharedTripView(r.row),
                }),
            };
        case "conflict":
            // **ぶつかった時は今の姿を添える**（画面が読み直さずに重ね直せる）
            return {
                statusCode: 409,
                headers: { ...JSON_HEADERS, "Cache-Control": "private, no-store" },
                body: JSON.stringify({
                    error: "ほかの仲間がこのプランを変えました。読み直してください",
                    code: "conflict",
                    plan: sharedTripView(r.row),
                }),
            };
        case "ok": return listResponse(userId, await readUserRows(tripsId(userId), isStoredTripPlan, `trips#${userId}`, true));
    }
}

/**
 * 日付の欄だけを組み立てる。
 *
 * **「送っていない」と「消したい」を分ける**——`null` か空文字なら消す、
 * 送っていなければ前の値のまま。読めない値（`2024-13-99`）は**断らずに
 * 落とす**のではなく、前の値を残す側に倒す（`dateWasRejected` が
 * 撮影日で潰した「黙って消える」を作らない）。
 */
export function dateFields(body: Record<string, unknown>, prev?: { startDate?: string; endDate?: string }): Partial<TripPlan> {
    const out: Partial<TripPlan> = {};
    for (const key of ["startDate", "endDate"] as const) {
        if (!(key in body)) continue;
        const raw = body[key];
        if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) {
            out[key] = undefined;
            continue;
        }
        const d = sanitizeTripDate(raw);
        out[key] = d ?? prev?.[key];
    }
    return out;
}

/**
 * 書き込みの共通部分。**応答は「書いたあとの一覧」を返す**
 * ——画面が自分で足し引きして持ち回ると、失敗した回に嘘の状態が残る。
 */
async function writeTrips(
    userId: string,
    failMessage: string,
    mutate: (list: TripPlan[]) => TripPlan[] | null,
) {
    try {
        const after: TripPlan[] = [];
        await updateUserList<TripPlan>(tripsId(userId), userId, NO_TRUNCATE, (list) => {
            // **読むときと同じふるいを先に通す。** 通さないと、形の壊れた行が
            // 1つ混ざっただけで「GET には出ないのに数には入る」ことになる
            const kept = list.filter(isStoredTripPlan);
            const next = mutate(kept);
            // **やり直し（CCF）のたびに置き直す。** 足し込むと前の試行が残る
            after.length = 0;
            after.push(...(next ?? kept));
            return next;
        });
        // **GET と同じものを返す**（3つの口が同じ一覧を見せる。共有したプランも合わせる・2026-11-12）
        return await listResponse(userId, after);
    } catch (e) {
        if (e instanceof TripLimitError) return jsonError(403, e.reason);
        if (e instanceof UserListError) {
            console.warn(`trips#${userId} の一覧が競合し続けました:`, e);
            return jsonError(503, "混み合っています。もう一度お試しください");
        }
        console.error("writeTrips error:", e);
        return jsonError(500, failMessage);
    }
}

// ---------------------------------------------------------------------------
// 共有したプラン（2026-11-12・資料「SNS をもっと SNS に」2b・owner 承認「DB の変更してもいいけどね」）
// ---------------------------------------------------------------------------
//
// ## 行の形（新しい GSI・表・TTL は作らない）
//
//     trips#<uid>          本人だけのプラン（今のまま。共有していないプランはここから動かさない）
//     trip#<planId>        **共有したプラン1つ**（持ち主・題・日付・日程・`memberIds[]`・`rev`）
//     tripsjoined#<uid>    その人が入っている共有プランの ID の一覧（新しい順・`updateUserList`）
//     tripchat#<planId>    プランの会話（`tripShare.ts`）
//     invite#<token>       招待リンク（共有アルバムと同じ行・`kind: "trip"`・`invite.ts`）
//
// ## 今のプランの移し方（2026-11-12 判断: **移す処理は流さない**）
//
// 共有していないプランは `trips#<uid>` に置いたまま。**「共有する」を押した時にだけ**、そのプラン1つを
// `trip#<planId>` へ移し（`shareTrip`）、一覧の行から外す。読む口（`GET /user/trips`）は両方を合わせて返す。
// 一斉に移す処理を流さないので、移す途中で落ちて消える・二重になる、が起きない
// （途中で落ちて両方に在るときは、読む口が共有の方を採る・`mergeTrips`）。
//
// ## 仲間の印は行に持つ（`tripmember#` の行は作らない）
//
// 共有アルバムは `albummember#<albumId>#<uid>` の印を別に持つが、アルバムは写真の行から「入っているか」を
// 1回で引くために要った。プランは**本体を読まずに仲間かを決める場面が無い**（読む・書く・話す、どれも本体を
// 読む）ので、`memberIds` の1か所にする（印と一覧の二重管理を作らない・`albums.ts` の `memberCount` の反省）。
//
// ## 誰の行か
//
// `trip#` は仲間の誰もが書くので、`updateUserRow` の `uid` には **planId** を入れる（GSI の欄 `userId` ではない）。
// 🔴 **`userId` の欄を持たせない**（`userId-createdAt-index` に載る。`invite.ts` の `albumKey` の注記と同じ）。

/** 共有したプランの本体 */
export const tripKey = (planId: string) => `trip#${planId}`;
/** その人が入っている共有プランの一覧 */
export const tripsJoinedKey = (uid: string) => `tripsjoined#${uid}`;

/** 1つのプランに入れる人数。旅の仲間を想定した数。**超えたら断る** */
export const TRIP_MEMBERS_MAX = 20;
/** 1人が入れる共有プランの数（自分のプランの上限 `TRIPS_MAX` とは別に数える） */
export const TRIPS_JOINED_MAX = 50;

export type SharedTrip = Omit<TripPlan, "visibility"> & {
    visibility: "shared";
    memberIds: string[];
    rev: number;
    inviteToken?: string;
    inviteExpiresAt?: string;
    /**
     * 持ち主が外した人（2026-11-12 確かめ役の指摘1）。**招待リンクでは戻れない**（`join` が断る）。
     * 持ち主が改めて直接共有したときだけ外す（`addTripMember` の `readmit`）。退会でも外す（`purgeTripSharesFor`）
     */
    removedIds?: string[];
    /**
     * 取り消した招待リンクのトークン（2026-11-12 指摘5）。招待の行（`invite#<token>`）は「取り消されています」と
     * 言うために残すが、**プランを消すときに一緒に消す**（プライバシーポリシー「プランが削除されるまで」）
     */
    pastInviteTokens?: string[];
};

/** 外した人の印の上限。超えたら古い方から落とす（20人の旅で外し続けても届かない数・行の大きさを抑える） */
export const TRIP_REMOVED_MAX = 200;
/** 取り消したリンクの控えの上限。超えたら古い方の招待の行をその場で消す（`tripShare.ts` の `retireInvite`） */
export const TRIP_PAST_INVITES_MAX = 20;

export const removedIdsOf = (row: { removedIds?: unknown } | null | undefined): string[] =>
    Array.isArray(row?.removedIds) ? (row!.removedIds as unknown[]).filter((v): v is string => typeof v === "string") : [];
export const pastInviteTokensOf = (row: { pastInviteTokens?: unknown } | null | undefined): string[] =>
    Array.isArray(row?.pastInviteTokens)
        ? (row!.pastInviteTokens as unknown[]).filter((v): v is string => isValidInviteToken(v))
        : [];

/** プラン ID の形（`randomUUID`）。任意の文字列を行の鍵にさせない */
export const isPlanId = (v: unknown): v is string =>
    typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

export function isStoredSharedTrip(x: unknown): x is SharedTrip {
    if (!isStoredTripPlan(x)) return false;
    const p = x as unknown as Partial<SharedTrip>;
    return Array.isArray(p.memberIds) && typeof p.ownerId === "string";
}

export function memberIdsOf(row: { memberIds?: unknown } | null | undefined): string[] {
    return Array.isArray(row?.memberIds) ? (row!.memberIds as unknown[]).filter((v): v is string => typeof v === "string") : [];
}

export const isTripMember = (row: SharedTrip | null, uid: string) => !!row && memberIdsOf(row).includes(uid);

export async function readSharedTrip(planId: string, consistent = false): Promise<SharedTrip | null> {
    if (!isPlanId(planId)) return null;
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE, Key: { id: tripKey(planId) }, ...(consistent ? { ConsistentRead: true } : {}),
    }));
    return isStoredSharedTrip(res.Item) ? (res.Item as SharedTrip) : null;
}

/**
 * 画面に返す形。**招待のトークンは出さない**（一覧は仲間の誰にでも返る。リンクは発行した画面だけに返す）。
 * `shared: true`・`memberIds`・`rev` は今の画面が知らない欄で、古いアプリ・Web は読み飛ばす
 */
export function sharedTripView(row: SharedTrip) {
    return {
        planId: row.planId,
        ownerId: row.ownerId,
        title: row.title,
        ...(row.startDate ? { startDate: row.startDate } : {}),
        ...(row.endDate ? { endDate: row.endDate } : {}),
        days: row.days,
        visibility: "shared" as const,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        shared: true as const,
        rev: row.rev,
        memberIds: memberIdsOf(row),
    };
}

/** その人が入っている共有プラン（新しい順）。**仲間から外れていた行は返さない** */
export async function listSharedTrips(uid: string): Promise<SharedTrip[]> {
    const ids = (await readUserList(tripsJoinedKey(uid), isPlanId, `tripsjoined#${uid}`)).slice(0, TRIPS_JOINED_MAX);
    if (ids.length === 0) return [];
    const res = await ddb.send(new BatchGetCommand({
        RequestItems: { [PHOTOS_TABLE]: { Keys: ids.map((planId) => ({ id: tripKey(planId) })) } },
    }));
    // 読み残し（`UnprocessedKeys`）は**投げる**——黙って欠けた一覧を返すと、画面が「消えた」と見せる
    if (Object.keys(res.UnprocessedKeys ?? {}).length > 0) throw new Error("listSharedTrips: 読み残しがありました");
    const byId = new Map<string, SharedTrip>();
    for (const item of (res.Responses?.[PHOTOS_TABLE] ?? []) as unknown[]) {
        if (isStoredSharedTrip(item) && memberIdsOf(item).includes(uid)) byId.set(item.planId, item);
    }
    return ids.map((id) => byId.get(id)).filter((p): p is SharedTrip => !!p);
}

/**
 * 本人だけのプランと共有したプランを1つの一覧に（**作った順・新しい順**）。
 * 同じ ID が両方に在る（共有する途中で落ちた）ときは共有の方を採る
 */
export function mergeTrips(own: readonly TripPlan[], shared: readonly SharedTrip[]) {
    const sharedIds = new Set(shared.map((p) => p.planId));
    const all: Array<{ at: string; view: unknown }> = [
        ...own.filter((p) => !sharedIds.has(p.planId)).map((p) => ({ at: p.createdAt ?? "", view: p as unknown })),
        ...shared.map((p) => ({ at: p.createdAt ?? "", view: sharedTripView(p) as unknown })),
    ];
    // 安定な並べ替え（同じ時刻は元の順）
    return all.map((x, i) => ({ ...x, i }))
        .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? 1 : -1))
        .map((x) => x.view);
}

/** 項目の同じさ（足した人を引き継ぐための鍵） */
const itemKey = (it: TripItem) => (it.kind === "spot" ? `s:${it.spotId}` : `l:${it.slug}`);

/**
 * 足した人（`by`）を付ける。**前から在った項目は前の `by` を引き継ぎ、新しく現れた項目は書いた人**。
 * 画面は `by` を送らなくてよい（古いアプリ・Web は送らない）——サーバーが前の日程と突き合わせて決める。
 * 同じ場所を2回置いたときは、前から在った数だけ引き継ぐ
 */
export function attributeItems(prev: readonly TripDay[], next: readonly TripDay[], caller: string):
    { days: TripDay[]; added: Array<{ item: TripItem; day: number }> } {
    const pool = new Map<string, Array<string | undefined>>();
    for (const d of prev) for (const it of d.items) {
        const k = itemKey(it);
        pool.set(k, [...(pool.get(k) ?? []), it.by]);
    }
    const added: Array<{ item: TripItem; day: number }> = [];
    const days = next.map((d, di) => ({
        ...d,
        items: d.items.map((it) => {
            const { by: _drop, ...bare } = it as TripItem & { by?: string };
            void _drop;
            const q = pool.get(itemKey(it));
            if (q && q.length > 0) {
                const by = q.shift();
                return (by ? { ...bare, by } : bare) as TripItem;
            }
            added.push({ item: bare as TripItem, day: di });
            return { ...bare, by: caller } as TripItem;
        }),
    }));
    return { days, added };
}

/** 共有したプランの書き込みの結果 */
export type SharedWrite =
    | { kind: "ok"; row: SharedTrip; added: Array<{ item: TripItem; day: number }> }
    | { kind: "notfound" }
    | { kind: "conflict"; row: SharedTrip }
    | { kind: "limit"; reason: string }
    | { kind: "badTitle" }
    /** 日程を `rev` 無しで送ってきた（共有を知らない古いアプリ）。読み直しても直らないので、別の言い分で断る */
    | { kind: "revRequired"; row: SharedTrip };

/** 書き込みの土台から外す欄（`updateUserRow` が付け直す） */
function rowFields(row: SharedTrip): Record<string, unknown> {
    const { id: _id, uid: _uid, rev: _rev, updatedAt: _u, ...rest } = row as SharedTrip & { id?: string; uid?: string };
    void _id; void _uid; void _rev; void _u;
    return rest;
}

/**
 * 共有したプランを直す（**仲間なら誰でも**）。送られた項目だけを差し替える（`updateTrip` と同じ）。
 *
 * **`rev` を送ってきたら、その版の上にだけ書く**（ぶつかりは 409 で返し、画面が読み直して重ね直す）。
 * **日程（`days`）は `rev` が無ければ 409**（2026-11-12）。題・日付だけなら `rev` 無しでも書ける
 * （読んで書くまでの間は `updateUserRow` の CAS で守る）。
 */
export async function updateSharedTrip(uid: string, planId: string, body: Record<string, unknown>): Promise<SharedWrite> {
    if (!isPlanId(planId)) return { kind: "notfound" };
    if ("title" in body && !sanitizeText(body.title, TRIP_TITLE_MAX)) return { kind: "badTitle" };
    const wantRev = typeof body.rev === "number" && Number.isInteger(body.rev) ? body.rev : undefined;
    let out = { kind: "notfound" } as SharedWrite;
    try {
        await updateUserRow(tripKey(planId), planId, (item) => {
            if (!isStoredSharedTrip(item) || !memberIdsOf(item).includes(uid)) { out = { kind: "notfound" }; return null; }
            if (wantRev !== undefined && item.rev !== wantRev) { out = { kind: "conflict", row: item }; return null; }
            // **日程を `rev` 無しで書かせない**（2026-11-12 確かめ役の指摘4）。`rev` を送らない画面（Web の古い版・
            // 共有を知らない古いアプリ）は、ほかの仲間が足した場所を知らないまま日程を丸ごと送ってくる＝上書きで消す。
            // 409 と今の姿を返し、画面に読み直させる（題・日付だけの直しは日程を消さないので今までどおり通す）
            if (wantRev === undefined && "days" in body) { out = { kind: "revRequired", row: item }; return null; }
            const attributed = "days" in body ? attributeItems(item.days, sanitizeDays(body.days), uid) : null;
            const next = {
                ...rowFields(item),
                ...("title" in body ? { title: sanitizeText(body.title, TRIP_TITLE_MAX)! } : {}),
                ...dateFields(body, item),
                ...(attributed ? { days: attributed.days } : {}),
                // **持ち主・仲間・公開範囲は本文から動かさない**
                ownerId: item.ownerId,
                memberIds: memberIdsOf(item),
                visibility: "shared",
            } as unknown as SharedTrip;
            if (!fitsPlanBudget(next as unknown as TripPlan)) throw new TripLimitError(PLAN_TOO_BIG);
            out = { kind: "ok", row: next, added: attributed?.added ?? [] };
            return next as unknown as Record<string, unknown>;
        });
    } catch (e) {
        if (e instanceof TripLimitError) return { kind: "limit", reason: e.reason };
        throw e;
    }
    const done = out as SharedWrite;
    if (done.kind !== "ok") return done;
    // 足した場所を会話に「日程に足しました」で置く（**落ちても日程の書き込みは通っている**ので止めない）
    if (done.added.length > 0) {
        await appendTripChat(planId, addedMessages(uid, done.added))
            .catch((e) => console.error(`updateSharedTrip: 会話に置けませんでした（${planId}）:`, (e as { name?: string })?.name));
    }
    // 書いたあとの姿（`rev`・`updatedAt` は `updateUserRow` が付けた値）を強い読みで返す
    const fresh = await readSharedTrip(planId, true);
    return fresh ? { ...done, row: fresh } : { kind: "notfound" };
}

/**
 * 一覧の行（`tripsjoined#<uid>`）: `list`（プラン ID・新しい順）と `reads`（プランごとに読んだ通し番号・`tripChat.ts`）。
 * **`updateUserList` は使わない**——あちらは `list` だけを書き戻すので `reads` が消える。同じ CAS の土台
 * （`updateUserRow`）で両方を書き戻す。**上限は数えて断る**（古い方を黙って落とさない）
 */
type Joined = { list: string[]; reads: Record<string, number>; left: string[] };

/**
 * `left`: **抜けた・外されたプラン**（2026-11-12 確かめ役の指摘5）。退会のとき、そのプランに残った本人の通と
 * 「足した人」の印も消すために覚えておく（今入っているプランは `list` で分かるが、前に抜けたプランは辿れない）。
 * 上限 `TRIPS_LEFT_MAX`（古い方から落とす）。もう一度入ったら `left` から外す
 */
function joinedFields(item: Record<string, unknown> | undefined): Joined {
    const list = Array.isArray(item?.list) ? (item!.list as unknown[]).filter(isPlanId) : [];
    const left = Array.isArray(item?.left) ? (item!.left as unknown[]).filter(isPlanId) : [];
    const raw = item?.reads;
    const reads: Record<string, number> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isPlanId(k) && typeof v === "number") reads[k] = v;
    }
    return { list, reads, left };
}

/** 抜けた・外されたプランの控えの上限（ID 36 字 × 500 ≒ 18KB。行の大きさを抑える） */
export const TRIPS_LEFT_MAX = 500;

export async function readJoined(uid: string): Promise<Joined> {
    const res = await ddb.send(new GetCommand({ TableName: PHOTOS_TABLE, Key: { id: tripsJoinedKey(uid) }, ConsistentRead: true }));
    return joinedFields(res.Item as Record<string, unknown> | undefined);
}

export async function joinIndexAdd(uid: string, planId: string): Promise<"ok" | "full"> {
    let full = false;
    await updateUserRow(tripsJoinedKey(uid), uid, (item) => {
        full = false;
        const { list, reads, left } = joinedFields(item);
        if (list.includes(planId)) return null;
        if (list.length >= TRIPS_JOINED_MAX) { full = true; return null; }
        return { list: [planId, ...list], reads, left: left.filter((x) => x !== planId) };
    });
    return full ? "full" : "ok";
}

/**
 * 一覧の行から外す。`remember` なら `left` に覚える（抜けた・外された＝プランは残る。退会で辿るため）。
 * プランごと消えたときと退会の掃除は覚えない
 */
export async function joinIndexRemove(uid: string, planId: string, remember = false): Promise<void> {
    await updateUserRow(tripsJoinedKey(uid), uid, (item) => {
        const { list, reads, left } = joinedFields(item);
        const nextLeft = remember ? [planId, ...left.filter((x) => x !== planId)].slice(0, TRIPS_LEFT_MAX) : left;
        const changed = list.includes(planId) || planId in reads || (remember && left[0] !== planId);
        if (!changed) return null;
        const { [planId]: _gone, ...rest } = reads;
        void _gone;
        return { list: list.filter((x) => x !== planId), reads: rest, left: nextLeft };
    });
}

/** 退会の掃除: `left` から外す（行そのものは `account.ts` が消す） */
export async function forgetLeft(uid: string, planId: string): Promise<void> {
    await updateUserRow(tripsJoinedKey(uid), uid, (item) => {
        const { list, reads, left } = joinedFields(item);
        if (!left.includes(planId)) return null;
        return { list, reads, left: left.filter((x) => x !== planId) };
    });
}

/** 会話をどこまで読んだか（通し番号）を置く。同じなら書かない */
export async function markTripRead(uid: string, planId: string, seq: number): Promise<void> {
    await updateUserRow(tripsJoinedKey(uid), uid, (item) => {
        const { list, reads, left } = joinedFields(item);
        if (!list.includes(planId) || (reads[planId] ?? -1) >= seq) return null;
        return { list, reads: { ...reads, [planId]: seq }, left };
    });
}

/**
 * プランを共有する（**持ち主だけ**）。本人だけの一覧（`trips#<uid>`）から `trip#<planId>` へ移す。
 *
 * 順番: 本体を作る → 自分の一覧の行に足す → 本人だけの一覧から外す。途中で落ちても、
 * もう一度押せば続きから進む（本体が在れば作らない）。両方に在る間は読む口が共有の方を採る
 */
export async function shareTrip(uid: string, planId: string):
    Promise<{ kind: "ok"; row: SharedTrip } | { kind: "notfound" } | { kind: "limit"; reason: string }> {
    if (!isPlanId(planId)) return { kind: "notfound" };
    let row = await readSharedTrip(planId, true);
    if (row && row.ownerId !== uid) return isTripMember(row, uid) ? { kind: "ok", row } : { kind: "notfound" };
    if (!row) {
        const own = await readUserRows(tripsId(uid), isStoredTripPlan, `trips#${uid}`, true);
        const plan = own.find((p) => p.planId === planId);
        if (!plan) return { kind: "notfound" };
        if ((await readJoined(uid)).list.length >= TRIPS_JOINED_MAX) {
            return { kind: "limit", reason: `共有できる旅行プランは${TRIPS_JOINED_MAX}個までです。使わないものを消してください` };
        }
        const now = new Date().toISOString();
        const item = {
            ...plan,
            id: tripKey(planId),
            uid: planId,
            ownerId: uid,
            visibility: "shared",
            memberIds: [uid],
            rev: 1,
            updatedAt: now,
        };
        try {
            await ddb.send(new PutCommand({
                TableName: PHOTOS_TABLE, Item: item, ConditionExpression: "attribute_not_exists(id)",
            }));
        } catch (e) {
            // 同時に2回押された。もう1本が作った本体を使う
            if ((e as { name?: string })?.name !== "ConditionalCheckFailedException") throw e;
        }
        row = await readSharedTrip(planId, true);
        if (!row) return { kind: "notfound" };
    }
    if (await joinIndexAdd(uid, planId) === "full") {
        return { kind: "limit", reason: `共有できる旅行プランは${TRIPS_JOINED_MAX}個までです。使わないものを消してください` };
    }
    await updateUserList<TripPlan>(tripsId(uid), uid, NO_TRUNCATE, (list) => {
        const next = list.filter((p) => !(isStoredTripPlan(p) && p.planId === planId));
        return next.length === list.length ? null : next;
    });
    return { kind: "ok", row };
}

/**
 * 仲間に足す（直接・招待リンクの参加の両方）。既に居れば `already`。
 * **持ち主が外した人は `removed`**（招待リンクでは戻さない・2026-11-12 指摘1）。`readmit` は持ち主が直接共有した
 * ときだけ立て、外した印を消して戻す
 */
export async function addTripMember(planId: string, newUid: string, opts: { readmit?: boolean } = {}):
    Promise<"ok" | "already" | "full" | "joinedFull" | "notfound" | "removed"> {
    let result = "notfound" as "ok" | "already" | "full" | "notfound" | "removed";
    // 先に本人の一覧の枠を見る（仲間に入れてから一覧に入らない、を作らない）
    const joined = (await readJoined(newUid)).list;
    if (!joined.includes(planId) && joined.length >= TRIPS_JOINED_MAX) return "joinedFull";
    await updateUserRow(tripKey(planId), planId, (item) => {
        if (!isStoredSharedTrip(item)) { result = "notfound"; return null; }
        const members = memberIdsOf(item);
        if (members.includes(newUid)) { result = "already"; return null; }
        const removed = removedIdsOf(item);
        if (removed.includes(newUid) && !opts.readmit) { result = "removed"; return null; }
        if (members.length >= TRIP_MEMBERS_MAX) { result = "full"; return null; }
        result = "ok";
        const rest = removed.filter((x) => x !== newUid);
        const { removedIds: _r, ...fields } = rowFields(item);
        void _r;
        return { ...fields, memberIds: [...members, newUid], ...(rest.length > 0 ? { removedIds: rest } : {}) };
    });
    if (result === "ok" || result === "already") {
        if (await joinIndexAdd(newUid, planId) === "full" && result === "ok") {
            // 同時の参加で枠を越えた。仲間から戻す（一覧に無いプランを抱えさせない）
            await removeTripMember(planId, newUid);
            return "joinedFull";
        }
    }
    return result;
}

/**
 * 仲間から外す（抜ける・持ち主が外す・退会）。**持ち主が抜けたら、残った最初の人が持ち主になる。
 * 誰も残らなければプランを消す**（会話・招待リンクも）。
 *
 * - `byOwner`: 持ち主が外した。`removedIds` に入れ、招待リンクで戻れなくする（2026-11-12 指摘1）
 * - `purge`: 退会の掃除。本人の一覧の行に「抜けた」を覚えない（行ごと消す）
 */
export async function removeTripMember(planId: string, uid: string, opts: { byOwner?: boolean; purge?: boolean } = {}):
    Promise<"ok" | "deleted" | "notmember"> {
    let result = "notmember" as "ok" | "deleted" | "notmember";
    if (isPlanId(planId)) {
        await updateUserRow(tripKey(planId), planId, (item) => {
            if (!isStoredSharedTrip(item)) { result = "notmember"; return null; }
            const members = memberIdsOf(item);
            if (!members.includes(uid)) { result = "notmember"; return null; }
            const rest = members.filter((m) => m !== uid);
            if (rest.length === 0) { result = "deleted"; return null; }
            result = "ok";
            const removed = opts.byOwner
                ? [...removedIdsOf(item).filter((x) => x !== uid), uid].slice(-TRIP_REMOVED_MAX)
                : removedIdsOf(item);
            const { removedIds: _r, ...fields } = rowFields(item);
            void _r;
            return {
                ...fields, memberIds: rest, ownerId: item.ownerId === uid ? rest[0] : item.ownerId,
                ...(removed.length > 0 ? { removedIds: removed } : {}),
            };
        });
        if (result === "deleted") await deleteSharedTripRows(planId);
    }
    await joinIndexRemove(uid, planId, result === "ok" && !opts.purge);
    return result;
}

/** プランを消す（持ち主・最後の1人が抜けた）。仲間ごとの一覧からも外す（落ちても読む口が仲間でない行を落とす） */
export async function deleteSharedTripRows(planId: string): Promise<void> {
    const row = await readSharedTrip(planId, true);
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: tripKey(planId) } }));
    await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: tripChatKey(planId) } }));
    // 生きているリンクと、取り消したリンク（2026-11-12 指摘5: 取り消した招待の行が残っていた）
    const live = row?.inviteToken && isValidInviteToken(row.inviteToken) ? [row.inviteToken] : [];
    for (const token of new Set([...live, ...pastInviteTokensOf(row)])) {
        await ddb.send(new DeleteCommand({ TableName: PHOTOS_TABLE, Key: { id: inviteKey(token) } }))
            .catch((e) => console.error(`deleteSharedTripRows: 招待を消せませんでした（${planId}）:`, (e as { name?: string })?.name));
    }
    for (const m of memberIdsOf(row)) {
        await joinIndexRemove(m, planId)
            .catch((e) => console.error(`deleteSharedTripRows: 一覧から外せませんでした（${m}）:`, (e as { name?: string })?.name));
    }
}
