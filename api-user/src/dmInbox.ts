import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, PHOTOS_TABLE } from "./dynamodb";

/**
 * DM（ダイレクトメッセージ）の**受信箱の読み取りだけ**。`dm.ts` から切り出してある。
 *
 * 切り出す理由は `blockCheck.ts` と同じ（循環の回避）——`notify.ts` はプッシュのバッジに
 * 「受信箱の未読会話数」を足すためにここを読む。`dm.ts` は `notify.ts` を import する
 * （送信者の名前・プッシュ）ので、`notify.ts` から `dm.ts` を import すると輪になる。
 * **読むだけの物と鍵の組み立てはここに集める**（書き込みは `dm.ts`）。
 *
 * ## 行の種類（2026-11-09・札 #505・新しい GSI・テーブル・TTL は作らない）
 *
 *     dm#<小さい uid>#<大きい uid>   会話の本体（メッセージの輪・会話の状態）
 *     dminbox#<uid>                  その人の受信箱（`convs.<会話ID>` の map ＋ 断った印）
 *     dmday#<uid>#<日付>             1日の歯止め（新規会話の人数・送信の数）
 *     dmreport#<会話ID>#<通報者>     通報時点の直近20通の写し
 */

/** 1人の受信箱に置ける会話の数。溢れたら**新しい会話を断る**（古い会話を黙って押し出さない） */
export const DM_CONVS_MAX = 200;

export const dmInboxId = (uid: string) => `dminbox#${uid}`;

/**
 * 受信箱の1行ぶん（`convs.<会話ID>`）。
 *   - `inbox`   ふつうの会話
 *   - `request` 相手からのリクエスト（承認か返信までは「リクエスト」の棚に置く）
 *   - `pending` 自分が送ったリクエスト（相手がまだ承認していない。自分の画面ではふつうの会話に出す）
 */
export type DmEntryState = "inbox" | "request" | "pending";

export type DmEntry = {
    /** 相手の uid */
    peer: string;
    /** 最後のメッセージの時刻（ISO） */
    t: string;
    /** 最後のメッセージの抜粋（先頭 `DM_EXCERPT_MAX` 字） */
    excerpt: string;
    /** この人から見た未読の数 */
    unread: number;
    state: DmEntryState;
};

export const DM_EXCERPT_MAX = 40;

/** 断ったリクエスト（相手 uid ごとの「承認されないまま送られた通数」）の属性名の接頭辞 */
export const DECLINED_PREFIX = "dec_";
export const declinedAttr = (senderUid: string) => `${DECLINED_PREFIX}${senderUid}`;

const STATES: ReadonlySet<string> = new Set<DmEntryState>(["inbox", "request", "pending"]);

/** 壊れた行で落ちないよう、形の違う項目は落として読む */
export function parseEntries(item: Record<string, unknown> | undefined): Record<string, DmEntry> {
    const raw = item?.convs;
    const out: Record<string, DmEntry> = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const e = v as Partial<DmEntry> | null;
        if (!e || typeof e.peer !== "string" || typeof e.state !== "string" || !STATES.has(e.state)) continue;
        out[id] = {
            peer: e.peer,
            t: typeof e.t === "string" ? e.t : "",
            excerpt: typeof e.excerpt === "string" ? e.excerpt : "",
            unread: typeof e.unread === "number" && e.unread > 0 ? e.unread : 0,
            state: e.state as DmEntryState,
        };
    }
    return out;
}

function parseDeclined(item: Record<string, unknown> | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    if (!item) return out;
    for (const [k, v] of Object.entries(item)) {
        if (k.startsWith(DECLINED_PREFIX) && typeof v === "number") out[k.slice(DECLINED_PREFIX.length)] = v;
    }
    return out;
}

export type DmInbox = {
    convs: Record<string, DmEntry>;
    /** 断ったリクエスト: 送り主 uid → 承認されないまま送られた通数 */
    declined: Record<string, number>;
};

export async function readDmInbox(uid: string, consistent = false): Promise<DmInbox> {
    const res = await ddb.send(new GetCommand({
        TableName: PHOTOS_TABLE,
        Key: { id: dmInboxId(uid) },
        ...(consistent ? { ConsistentRead: true } : {}),
    }));
    const item = res.Item as Record<string, unknown> | undefined;
    return { convs: parseEntries(item), declined: parseDeclined(item) };
}

/**
 * 未読のある会話の数。**リクエストは数えない**（リクエストはバッジにも出さない・2026-11-09 owner 承認）。
 * ブロックの相手（`hidden`）の会話も数えない——画面から隠すものをバッジに出すと
 * 「バッジ1 → 開くと何も無い」になる（`visibleUnread` と同じ理由）。
 */
export function unreadConvCount(convs: Record<string, DmEntry>, hidden: ReadonlySet<string>): number {
    let n = 0;
    for (const e of Object.values(convs)) {
        if (e.state === "request" || e.unread <= 0 || hidden.has(e.peer)) continue;
        n++;
    }
    return n;
}

/** プッシュのバッジに足す数。読めなければ 0（バッジが減る側＝送らないより送る側に倒す） */
export async function dmUnreadConvCount(uid: string, hidden: ReadonlySet<string>): Promise<number> {
    try {
        return unreadConvCount((await readDmInbox(uid)).convs, hidden);
    } catch (e) {
        console.error("dmUnreadConvCount: 受信箱を読めませんでした:", (e as { name?: string })?.name);
        return 0;
    }
}
