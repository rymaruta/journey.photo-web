/**
 * 意見箱（札 #546・2026-11-11）の Web の送り手。保存の形と上限はサーバーの `api-user/src/feedback.ts`。
 *
 * 口はログインの有無で分ける:
 *   ログインしている  `POST /user/feedback`（`userFetch`・返事が欲しいを受ける）
 *   していない        `POST /feedback`（`userPublicFetch`・IP ごとの上限。返事は約束しない）
 *
 * 写真を添えたときは、応答の署名つき URL へ PUT する（`toUploadSafeFile` を通した＝位置と撮影情報を落とした1枚）。
 * **id は送る前に作って持ち続ける**——押し直し・送り直しでもサーバーでは1件のまま。
 */

/** サーバーの `FEEDBACK_TEXT_MAX` と同じ */
export const FEEDBACK_TEXT_MAX = 1000;
/** サーバーの `FEEDBACK_PHOTO_MAX_BYTES` と同じ */
export const FEEDBACK_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

export type FeedbackScreen = "web-footer" | "web-settings" | "web";

export type FeedbackBody = {
    id: string;
    text: string;
    screen: FeedbackScreen;
    platform: "web";
    wantsReply: boolean;
    photo?: { contentType: string; size: number };
};

/** `?from=` から画面の名前へ（知らない値は `web`） */
export function screenFrom(from: string | null | undefined): FeedbackScreen {
    if (from === "footer") return "web-footer";
    if (from === "settings") return "web-settings";
    return "web";
}

/** 送る本文。**ログインしていない人は返事を約束しない**（宛先が無い） */
export function feedbackBody(p: {
    id: string; text: string; screen: FeedbackScreen; wantsReply: boolean; signedIn: boolean; photo?: { type: string; size: number } | null;
}): FeedbackBody {
    return {
        id: p.id,
        text: p.text.trim(),
        screen: p.screen,
        platform: "web",
        wantsReply: p.signedIn && p.wantsReply,
        ...(p.photo ? { photo: { contentType: p.photo.type, size: p.photo.size } } : {}),
    };
}

export type FeedbackResult =
    | { ok: true }
    /** 通信が届かなかった（書いたものは欄に残す。押し直せば同じ id で送る） */
    | { ok: false; offline: true }
    | { ok: false; offline: false; message: string; textDelivered?: true };

/**
 * 本文は届いたが写真だけ送れなかった。**本文はもう保存されている**ので、呼び手は id を新しくし、欄を空にする
 * （同じ id で本文を直して送り直すと、サーバーは「もう在る」と読んで直した本文を捨てる）
 */
const PHOTO_FAILED: FeedbackResult = { ok: false, offline: false, message: "ひとことは届きました。写真は送れませんでした", textDelivered: true };

type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

/**
 * 1件送る。`post` はログインの有無に合わせて呼び手が選ぶ（`userFetch` か `userPublicFetch`）。
 * `put` は写真の PUT（素の `fetch`。試験で差し替える）
 */
export async function sendFeedback(
    body: FeedbackBody,
    photo: Blob | null,
    deps: { post: Fetcher; put?: (url: string, init: RequestInit) => Promise<Response>; signedIn: boolean },
): Promise<FeedbackResult> {
    let res: Response;
    try {
        res = await deps.post(deps.signedIn ? "/user/feedback" : "/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        return { ok: false, offline: true };
    }
    if (!res.ok) {
        let message = "送れませんでした。しばらくしてからもう一度お試しください";
        try {
            const data = await res.json() as { error?: unknown };
            if (typeof data.error === "string" && data.error) message = data.error;
        } catch { /* 既定の文 */ }
        return { ok: false, offline: false, message };
    }
    if (!photo) return { ok: true };
    let upload: { url?: unknown; contentType?: unknown } | undefined;
    try {
        upload = (await res.json() as { upload?: { url?: unknown; contentType?: unknown } }).upload;
    } catch { /* 写真の署名が読めない */ }
    if (!upload || typeof upload.url !== "string" || typeof upload.contentType !== "string") {
        // 本文は届いている。写真だけ送れなかったことを言う
        return PHOTO_FAILED;
    }
    try {
        const put = deps.put ?? ((url: string, init: RequestInit) => fetch(url, init));
        // 署名に入っている種別と同じ文字列で送る（違うと 403）
        const r = await put(upload.url, { method: "PUT", headers: { "Content-Type": upload.contentType }, body: photo });
        if (!r.ok) return PHOTO_FAILED;
    } catch {
        return PHOTO_FAILED;
    }
    return { ok: true };
}

/** 書きかけを端末に残す鍵の頭（送れなかったとき・閉じたときに失わない） */
export const FEEDBACK_DRAFT_KEY = "jp_feedback_draft";

/**
 * 書きかけの鍵は**人ごと**（ログインしていなければ `anon`）。同じ端末で次にログインした別の人に、
 * 前の人の書きかけを見せない。ログアウト・退会では全部消す（`forgetFeedbackDrafts`）
 */
export const feedbackDraftKey = (userId: string | null | undefined) => `${FEEDBACK_DRAFT_KEY}:${userId || "anon"}`;

/** 書きかけを全部消す（`app/auth/context.tsx` の `clearAccountLocalState`）。読めない環境では何もしない */
export function forgetFeedbackDrafts(storage?: Storage): void {
    try {
        const s = storage ?? window.localStorage;
        const keys: string[] = [];
        for (let i = 0; i < s.length; i++) {
            const k = s.key(i);
            if (k && (k === FEEDBACK_DRAFT_KEY || k.startsWith(`${FEEDBACK_DRAFT_KEY}:`))) keys.push(k);
        }
        keys.forEach((k) => s.removeItem(k));
    } catch { /* 端末に触れない環境 */ }
}
