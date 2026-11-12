import { drawShareCountryMap, loadShareOutlines } from "./shareMap";
import { drawInstant, drawTate, type TakenDate } from "./shareCardStyles";
import { metaPlace } from "./metaPlace";
import { MINCHO_STACK } from "./storyText";

/** iOS SignatureShareCardRenderer と同じSNS用の画像比率・撮影位置の秘匿規則。 */
export type ShareCardRatio = "4:5" | "9:16" | "1:1";
export const SHARE_CARD_WIDTH = 1080;
export const SHARE_CARD_HEIGHT: Record<ShareCardRatio, number> = {
    "4:5": 1350,
    "9:16": 1920,
    "1:1": 1080,
};
export type ShareCardCredit = {
    name: string;
    username?: string;
    location?: string;
    camera?: string;
    lens?: string;
    verified?: boolean;
    pro?: boolean;
    early?: boolean;
    badge?: string;
    coords?: { lat: number; lng: number };
    /** 撮った日（縦書き・インスタントの字）。無ければ出さない */
    taken?: TakenDate | null;
};

/**
 * **カードの型**（2026-11-12 デザインの案 第8章）。`band` は今までの Web の型（写真の下に黒い帯）。
 * 縦書き・インスタントは iOS と同じ寸法（`shareCardStyles.ts`）。表紙・フェード・展示札は iOS だけ（Web へ移すのは別の札）
 */
export type ShareCardStyle = "tate" | "instant" | "band";
/** 選ぶ画面の見本の列の並び */
export const SHARE_CARD_STYLES: readonly ShareCardStyle[] = ["tate", "instant", "band"];
/**
 * 初めての人の型。2026-11-12 秘書室の判断: **縦書き（落款つき）**で iOS とそろえる（`Style.firstChoice`）。
 * 第8章「新しい型を出した後は縦書きに替えてよい」・縦書きは新しい型の第一の推奨（写真を削らず、格子でも形で分かる）
 */
export const SHARE_CARD_FIRST_STYLE: ShareCardStyle = "tate";
export const SHARE_CARD_STYLE_KEY = "signatureShare.style";

/** 前に使った型（読めない値・iOS にしか無い型なら初めてと同じ） */
export function initialShareCardStyle(stored: string | null | undefined): ShareCardStyle {
    return (SHARE_CARD_STYLES as readonly string[]).includes(stored ?? "") ? stored as ShareCardStyle : SHARE_CARD_FIRST_STYLE;
}

export function shareCardStyleName(style: ShareCardStyle, locale: "ja" | "en"): string {
    const names: Record<ShareCardStyle, [string, string]> = { tate: ["縦書き", "Vertical"], instant: ["インスタント", "Instant"], band: ["帯", "Band"] };
    return names[style][locale === "en" ? 1 : 0];
}

/** 比率の言葉（どこに貼るか） */
export function shareCardRatioLabel(ratio: ShareCardRatio, locale: "ja" | "en"): string {
    const labels: Record<ShareCardRatio, [string, string]> = { "4:5": ["投稿", "Post"], "9:16": ["ストーリー", "Story"], "1:1": ["正方形", "Square"] };
    return labels[ratio][locale === "en" ? 1 : 0];
}

/** 地名を大きい単位（県・国）と小さい単位（市区町村）に分ける（`metaPlace` の表を使う） */
export function shareCardPlace(location?: string): { big: string; sub: string } {
    const p = metaPlace(location);
    const big = p.pref || p.head;
    const sub = [p.area, p.pref ? p.head : ""].find(v => v && v !== big) ?? "";
    return { big, sub };
}

/** iOSと同じ0.5度刻み。共有画像には生のGPS座標を埋め込まない。 */
export function approximateShareCoordinate(coords?: ShareCardCredit["coords"]) {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)
        || Math.abs(coords.lat) > 90 || Math.abs(coords.lng) > 180) return null;
    return { lat: Math.round(coords.lat * 2) / 2, lng: Math.round(coords.lng * 2) / 2 };
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
    if (maxWidth <= ctx.measureText("…").width) return "";
    if (ctx.measureText(text).width <= maxWidth) return text;
    let shortened = text;
    while (shortened.length && ctx.measureText(shortened + "…").width > maxWidth) {
        shortened = shortened.slice(0, -1);
    }
    return shortened + "…";
}

/** 元画像のEXIFを持ち込まない新規Canvasで、枠の外を含まないJPEGを生成する。 */
export async function renderShareCard(photo: CanvasImageSource, credit: ShareCardCredit, ratio: ShareCardRatio = "4:5",
    style: ShareCardStyle = "band", outputWidth: number = SHARE_CARD_WIDTH): Promise<Blob> {
    const sharedPin = approximateShareCoordinate(credit.coords);
    const outlines = sharedPin ? await loadShareOutlines().catch(() => []) : [];
    // Use the same branded aperture mark as the Web login screen; image retrieval is best-effort.
    const brandMark = await fetch("/logo-aperture.png")
        .then(async response => response.ok ? createImageBitmap(await response.blob()) : null)
        .catch(() => null);
    const canvas = document.createElement("canvas");
    // 見本の列の小さな絵は画素だけ縮める（寸法は 1080 の座標のまま・iOS の outputWidth と同じ）
    const pixelScale = Math.max(0.05, Math.min(1, outputWidth / SHARE_CARD_WIDTH));
    canvas.width = Math.round(SHARE_CARD_WIDTH * pixelScale);
    canvas.height = Math.round(SHARE_CARD_HEIGHT[ratio] * pixelScale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    ctx.scale(pixelScale, pixelScale);
    if (style === "tate" || style === "instant") {
        const source = photo as { width: number; height: number };
        if (!(source.width > 0 && source.height > 0)) throw new Error("Invalid photo");
        // 明朝は `--font-mincho`（next/font が立てる字の名前）を解いて使う。字が届くのを待ってから描く
        const minchoVar = typeof document !== "undefined"
            ? getComputedStyle(document.body).getPropertyValue("--font-mincho").trim() : "";
        const mincho = minchoVar ? `${minchoVar},${MINCHO_STACK}` : MINCHO_STACK;
        const place = shareCardPlace(credit.location);
        await document.fonts?.load(`700 64px ${mincho}`, place.big + place.sub + "年月〇一二三四五六七八九十" + (credit.name[0] ?? "")).catch(() => []);
        const assets = {
            mincho,
            serif: 'ui-serif,"New York",Georgia,serif',
            sans: '-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",system-ui,sans-serif',
            brandMark,
            drawMap: sharedPin && style === "instant"
                ? (c: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, color: string) =>
                    drawShareCountryMap(c, outlines, sharedPin, rect, color)
                : undefined,
        };
        const styleCredit = {
            name: credit.name, username: credit.username, place, taken: credit.taken ?? null,
        };
        if (style === "tate") drawTate(ctx, photo, styleCredit, ratio, assets);
        else drawInstant(ctx, photo, styleCredit, ratio, assets);
        brandMark?.close();
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("JPEG export failed")), "image/jpeg", 0.93);
        });
    }
    const w = SHARE_CARD_WIDTH, h = SHARE_CARD_HEIGHT[ratio];
    const brass = "#c9a66b";
    ctx.fillStyle = "#0e0e0f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    if (brandMark) {
        ctx.drawImage(brandMark, 95, 62, 45, 45);
        brandMark.close();
    }
    ctx.font = "bold 40px Georgia, serif";
    ctx.fillText("Journey Photo", brandMark ? 155 : 70, 96);
    ctx.font = "24px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("旅の一瞬を、誰かの次の旅へ。", 1010, 93);
    ctx.textAlign = "left";
    ctx.fillStyle = brass;
    ctx.fillRect(48, 122, 984, 2);

    const x = 48, y = 145, width = 984, bottom = h - (ratio === "9:16" ? 430 : 355);
    const photoHeight = bottom - y;
    const source = photo as { width: number; height: number };
    const sw = source.width, sh = source.height;
    if (!(sw > 0 && sh > 0)) throw new Error("Invalid photo");
    const scale = Math.max(width / sw, photoHeight / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, width, photoHeight); ctx.clip();
    ctx.drawImage(photo, x + (width - dw) / 2, y + (photoHeight - dh) / 2, dw, dh);
    ctx.restore();

    const fade = ctx.createLinearGradient(0, bottom - 170, 0, bottom + 25);
    fade.addColorStop(0, "rgba(14,14,15,0)");
    fade.addColorStop(1, "#0e0e0f");
    ctx.fillStyle = fade;
    ctx.fillRect(x, bottom - 170, width, 195);
    ctx.fillStyle = "#0e0e0f";
    ctx.fillRect(x, bottom, width, h - bottom - 48);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 38px sans-serif";
    const photographer = fitText(ctx, credit.name || "Photographer", 650);
    ctx.fillText(photographer, 85, bottom + 90);
    const nameEndX = 85 + ctx.measureText(photographer).width;
    let marks = "";
    if (credit.verified) marks += " ✓";
    if (credit.pro) marks += " PRO";
    if (credit.early) marks += " ★";
    if (credit.badge) marks += " " + credit.badge;
    if (marks) {
        ctx.fillStyle = brass;
        ctx.font = "23px sans-serif";
        const availableMarkWidth = 995 - (nameEndX + 12);
        if (availableMarkWidth > 20) ctx.fillText(fitText(ctx, marks.trim(), availableMarkWidth), nameEndX + 12, bottom + 90);
    }
    ctx.fillStyle = "#b8b8b8";
    ctx.font = "26px sans-serif";
    if (credit.username) ctx.fillText(fitText(ctx, "@" + credit.username.replace(/^@/, ""), 860), 85, bottom + 155);
    if (credit.location) ctx.fillText(fitText(ctx, credit.location, sharedPin ? 640 : 850), 85, bottom + 202);
    if (sharedPin) drawShareCountryMap(ctx, outlines, sharedPin, { x: 785, y: bottom + 65, width: 195, height: 128 }, brass);
    const details = [credit.camera, credit.lens].filter((v): v is string => Boolean(v));
    ctx.font = "23px sans-serif";
    details.forEach((detail, i) => ctx.fillText(fitText(ctx, detail, 875), 85, bottom + 255 + i * 34));
    // 国境輪郭とピンは概略位置のみで描画。生のGPSとEXIFは画像へ引き継がない。
    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("JPEG export failed")), "image/jpeg", 0.93);
    });
}
