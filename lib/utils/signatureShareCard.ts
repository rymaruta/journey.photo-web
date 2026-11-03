import { drawShareCountryMap, loadShareOutlines } from "./shareMap";

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
};

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
export async function renderShareCard(photo: CanvasImageSource, credit: ShareCardCredit, ratio: ShareCardRatio = "4:5"): Promise<Blob> {
    const sharedPin = approximateShareCoordinate(credit.coords);
    const outlines = sharedPin ? await loadShareOutlines().catch(() => []) : [];
    // Use the same branded aperture mark as the Web login screen; image retrieval is best-effort.
    const brandMark = await fetch("/logo-aperture.png")
        .then(async response => response.ok ? createImageBitmap(await response.blob()) : null)
        .catch(() => null);
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_CARD_WIDTH;
    canvas.height = SHARE_CARD_HEIGHT[ratio];
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    const w = canvas.width, h = canvas.height;
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
