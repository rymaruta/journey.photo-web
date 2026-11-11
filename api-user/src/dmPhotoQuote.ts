import { readVisiblePhoto, type VisiblePhotoRow } from "./photoVisibility";
import { isRestrictedRow } from "./sanitize";
import { signPhotoImages } from "./signedUrl";

/**
 * DM の会話に出す「送った写真」の札（2026-11-11・札 #541・`dmStoryQuote.ts` と同じ作り）。
 * `GET /dm/{id}` が、`photoId` を持つ通にだけ付ける。
 *
 *     { id, state: "live", src, title?, location?, ownerId? }   見られる
 *     { id, state: "gone" }                                     見られない（消した・非公開・範囲の外・ブロック）
 *
 * ## 見せる門は保存・写真の頁と同じ（`photoVisibility.ts`）
 *
 * **読む人ごとに**、その人に今見せてよい写真かを確かめる。送った時に見えていても、持ち主が消した・
 * 非公開に戻した・公開範囲を絞った・読む人をブロックしたら `gone`——DM が「見せない相手に写真を渡す
 * 2本目の口」にならないように（「まだ在るが、あなたには見せない」を区別して出さない）。
 * **読めなかったら `gone`**（見せない側に倒す）。絵は一覧の縮小版（`thumbSrc`・512px）、無ければ `src`。
 */
export type PhotoQuote =
    | { id: string; state: "live"; src: string; title?: string; location?: string; ownerId?: string }
    | { id: string; state: "gone" };

/** 1回の会話の読みで引く写真の数の上限（`dmStoryQuote.ts` の `QUOTE_LOOKUP_MAX` と同じ考え） */
export const PHOTO_QUOTE_MAX = 20;
const errName = (e: unknown) => (e as { name?: string })?.name ?? "Error";

/** 題は文字か、言語ごとの表（`{ja, en}`）。日本語 → 英語 → 最初の値の順に1つ選ぶ */
export function titleText(raw: unknown): string | undefined {
    if (typeof raw === "string") return raw.trim() || undefined;
    if (raw && typeof raw === "object") {
        const r = raw as Record<string, unknown>;
        for (const v of [r.ja, r.en, ...Object.values(r)]) {
            if (typeof v === "string" && v.trim()) return v.trim();
        }
    }
    return undefined;
}

function shape(id: string, row: VisiblePhotoRow): PhotoQuote {
    // **公開範囲を絞った写真の絵は署名つき URL にする**（絞った写真は `/private/` に置かれ、署名が無いと 403。
    // 一覧 `/feed/restricted`（`restrictedFeed.ts`）・自分の写真（`userPhotos.ts`）と同じ `signPhotoImages`。
    // 鍵が無い環境では何もしない）。公開の写真は署名しない（一覧と同じ URL のまま・控えが効く）
    const r = isRestrictedRow(row) ? signPhotoImages({ ...row } as Record<string, unknown>) as VisiblePhotoRow : row;
    const thumb = typeof r.thumbSrc === "string" && r.thumbSrc ? r.thumbSrc : undefined;
    const src = thumb ?? (typeof r.src === "string" ? r.src : "");
    if (!src) return { id, state: "gone" };
    const title = titleText(row.title);
    const location = typeof row.location === "string" && row.location.trim() ? row.location.trim() : undefined;
    const ownerRaw = row.userId ?? row.uploadedBy;
    const ownerId = typeof ownerRaw === "string" && ownerRaw ? ownerRaw : undefined;
    return { id, state: "live", src, ...(title ? { title } : {}), ...(location ? { location } : {}), ...(ownerId ? { ownerId } : {}) };
}

/**
 * `viewer` から見た写真の札を、写真 ID ごとに返す。**投げない**。上限を越えた古い写真は Map に入れない（札なし）。
 * 1件ずつの GetItem（photos の表に `BatchGetItem` の権限は無い・`dmStoryQuote.ts` と同じ）。
 */
export async function photoQuotesFor(viewer: string, photoIds: readonly string[]): Promise<Map<string, PhotoQuote>> {
    const out = new Map<string, PhotoQuote>();
    const order = new Map<string, true>();
    for (const s of photoIds) {
        if (typeof s !== "string" || s.length === 0) continue;
        order.delete(s);
        order.set(s, true);
    }
    const targets = [...order.keys()].slice(-PHOTO_QUOTE_MAX);
    await Promise.all(targets.map(async (id) => {
        try {
            const row = await readVisiblePhoto(id, viewer);
            out.set(id, row ? shape(id, row) : { id, state: "gone" });
        } catch (e) {
            console.error("photoQuotesFor: 写真を読めませんでした:", errName(e));
            out.set(id, { id, state: "gone" });
        }
    }));
    return out;
}
