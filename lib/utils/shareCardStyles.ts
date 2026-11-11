/**
 * **SNS に貼るカードの新しい型「縦書き」「インスタント」**（2026-11-12・デザインの案 第8章・札 #438 の続き）。
 *
 * iOS の `SignatureShareCardStyles.swift`（`renderTate` / `renderInstant`）と `ShareCardMap.TateLayout` /
 * `InstantLayout` の寸法の写し。寸法は 1080 幅の座標で持ち、描く処理（Canvas）から切り出して試験で縛る。
 *
 * - 縦書き: 写真を全面に敷き、地名を大きな縦の明朝で右の端に。地名の下に白い落款（撮影者の頭文字）。
 *   左下は @名とロゴだけ（機材の行と URL は置かない）。字はすべて写真の上なので白だけ（真鍮は使わない）
 * - インスタント: 生成りの紙に写真を貼り、下の余白に地名を墨で。周りは同じ写真をぼかして暗く敷く。
 *   紙の色は共有の絵の中だけで使い、サイトの画面には使わない
 * - 9:16 は上 140・下 170 を空ける（インスタのストーリーの名前と返信の欄）
 */
import type { ShareCardRatio } from "./signatureShareCard";

export type TakenDate = { year: number; month: number; day: number };

/** 「2026:10:25 14:03:00」（EXIF）・「2026-10-25」から年・月・日を取る。読めない値は null（字を作らない） */
export function takenDate(exif?: string, date?: string): TakenDate | null {
    for (const raw of [exif, date]) {
        const text = raw?.trim() ?? "";
        if (text.length < 10) continue;
        const parts = text.slice(0, 10).split(/[:\-/.]/).map(Number);
        if (parts.length !== 3 || parts.some(n => !Number.isInteger(n))) continue;
        const [year, month, day] = parts;
        if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) continue;
        return { year, month, day };
    }
    return null;
}

/** 「2026.10.25」（インスタントの紙の字） */
export function dottedDate(d: TakenDate): string {
    return `${d.year}.${String(d.month).padStart(2, "0")}.${String(d.day).padStart(2, "0")}`;
}

const KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 「二〇二六年十月」（縦書きの字） */
export function kanjiYearMonth(d: TakenDate): string {
    const year = String(d.year).split("").map(c => KANJI[Number(c)]).join("");
    const month = d.month === 10 ? "十" : d.month > 10 ? "十" + KANJI[d.month - 10] : KANJI[d.month];
    return `${year}年${month}月`;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** 英語の縦書きは「OCT 2026」（横に倒して書く） */
export function englishMonthYear(d: TakenDate): string {
    return `${MONTHS[d.month - 1]} ${d.year}`;
}

/** 仮名・漢字が1字でもあれば立てて1字ずつ並べる。欧文だけなら行ごと右へ倒す（縦組みの習い） */
export function isUprightVertical(text: string): boolean {
    return /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ々-〇]/.test(text);
}

/** 立てた字の中で、横に倒す字（長音・波ダッシュ・括弧） */
export function rotatesInVertical(ch: string): boolean {
    return "ー－〜～―…（）()「」-".includes(ch);
}

// ---------- 寸法（iOS の ShareCardMap と同じ数） ----------

export function tateLayout(ratio: ShareCardRatio) {
    const height = ratio === "9:16" ? 1920 : ratio === "1:1" ? 1080 : 1350;
    const story = ratio === "9:16", square = ratio === "1:1";
    const top = story ? 140 : 0, base = height - (story ? 170 : 0);
    const placeFontSize = square ? 128 : story ? 184 : 156;
    const placeTop = top + (square ? 56 : 72);
    const sealSize = square ? 76 : 88;
    const columnBottom = base - 60;
    return {
        height, top, base, placeFontSize, placeTop, sealSize, columnBottom,
        placeMinimumFontSize: 72, placeStep: 1.04, sealGap: 28, rightEdge: 1010,
        subFontSize: 48, subStep: 1.1, dateFontSize: 38, dateStep: 1.08, columnGap: 30,
        bottomShadeTop: base - 420,
        usernameTop: base - 150, usernameFontSize: 30,
        brandCenterY: base - 78, brandMarkSize: 38, brandWordSize: 32,
        margin: 60, leftColumnWidth: 560,
        /** 字数 count の和文の地名を、落款まで含めて columnBottom に収める字の大きさ（下限 72） */
        fittedPlaceSize(count: number): number {
            if (count <= 0) return placeFontSize;
            const available = columnBottom - placeTop - 28 - sealSize;
            return Math.max(72, Math.min(placeFontSize, Math.floor(available / (count * 1.04))));
        },
    };
}

export function instantLayout(ratio: ShareCardRatio) {
    const height = ratio === "9:16" ? 1920 : ratio === "1:1" ? 1080 : 1350;
    const story = ratio === "9:16", square = ratio === "1:1";
    const top = story ? 140 : 0, base = height - (story ? 170 : 0);
    const photoWidth = square ? 640 : 800;
    const photoHeight = story ? photoWidth * 4 / 3 : photoWidth;
    const paperMargin = 44, paperBottom = square ? 180 : 216;
    const paperW = photoWidth + paperMargin * 2, paperH = photoHeight + paperMargin + paperBottom;
    const paper = { x: 540 - paperW / 2, y: top + (square ? 50 : story ? 80 : 70), width: paperW, height: paperH };
    const photo = { x: paper.x + paperMargin, y: paper.y + paperMargin, width: photoWidth, height: photoHeight };
    const photoBottom = photo.y + photoHeight;
    const brandCenterY = paper.y + paperH + (square ? 60 : 82);
    return {
        height, top, base, paper, photo, paperMargin, paperBottom,
        paperTiltDegrees: -2.2, tapeTiltDegrees: 4, tape: { width: 300, height: 64 },
        placeTop: photoBottom + (square ? 34 : 44), placeFontSize: square ? 50 : 56, placeMinimumFontSize: 34,
        metaTop: photoBottom + (square ? 108 : 128), metaFontSize: 28, textWidth: photoWidth - 150,
        map: { x: photo.x + photoWidth - 120, y: photoBottom + 26, width: 120, height: paperBottom - 52 },
        brandCenterY, brandMarkSize: 38, brandWordSize: 32, addressTop: brandCenterY + 36, addressFontSize: 24,
        backdropBrightness: 0.4,
    };
}

// ---------- 描く ----------

export type StyleCredit = {
    name: string;
    username?: string;
    /** 大きい単位（県・国）と小さい単位（市区町村） */
    place: { big: string; sub: string };
    taken: TakenDate | null;
};

export type StyleAssets = {
    /** 明朝の字の並び（`--font-mincho` を解いたもの＋端末の明朝） */
    mincho: string;
    serif: string;
    sans: string;
    brandMark: ImageBitmap | null;
    drawMap?: (ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, color: string) => void;
};

const INK = "#07090A", PAPER = "#F3EEE3";
const SITE = "journey-photo.com";

function drawCover(ctx: CanvasRenderingContext2D, photo: CanvasImageSource, x: number, y: number, w: number, h: number) {
    const source = photo as { width: number; height: number };
    const scale = Math.max(w / source.width, h / source.height);
    const dw = source.width * scale, dh = source.height * scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.drawImage(photo, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
}

function shade(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number,
    rect: { x: number; y: number; width: number; height: number }, stops: Array<[number, number]>) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([p, a]) => g.addColorStop(p, `rgba(0,0,0,${a})`));
    ctx.fillStyle = g;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

/** 1行の字。幅に入るまで 1 ずつ縮め（下限まで）、それでも入らなければ末尾を「…」で切る */
function fitText(ctx: CanvasRenderingContext2D, text: string, family: string, weight: number, size: number,
    min: number, maxWidth: number): { text: string; size: number } {
    let s = size;
    ctx.font = `${weight} ${s}px ${family}`;
    while (s > min && ctx.measureText(text).width > maxWidth) { s -= 1; ctx.font = `${weight} ${s}px ${family}`; }
    let t = text;
    if (ctx.measureText(t).width > maxWidth) {
        while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
        t += "…";
    }
    return { text: t, size: s };
}

function verticalLength(ctx: CanvasRenderingContext2D, text: string, size: number, step: number, family: string): number {
    if (isUprightVertical(text)) return [...text].length * size * step;
    ctx.font = `700 ${size}px ${family}`;
    return ctx.measureText(text).width;
}

/** 縦の列を描く。描いた長さを返す */
function drawVertical(ctx: CanvasRenderingContext2D, text: string, cx: number, top: number, size: number,
    step: number, color: string, family: string): number {
    ctx.font = `700 ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (!isUprightVertical(text)) {
        ctx.save();
        ctx.translate(cx, top);
        ctx.rotate(Math.PI / 2);
        ctx.textAlign = "left";
        ctx.fillText(text, 0, 0);
        ctx.restore();
        return verticalLength(ctx, text, size, step, family);
    }
    [...text].forEach((ch, i) => {
        ctx.save();
        ctx.translate(cx, top + i * size * step + size / 2);
        if (rotatesInVertical(ch)) ctx.rotate(Math.PI / 2);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
    });
    return [...text].length * size * step;
}

function brandRowWidth(ctx: CanvasRenderingContext2D, mark: number, word: number, serif: string): number {
    ctx.font = `400 ${word}px ${serif}`;
    return mark * 1.38 + ctx.measureText("Journey Photo").width;
}

function drawBrandRow(ctx: CanvasRenderingContext2D, left: number, cy: number, mark: number, word: number,
    assets: StyleAssets) {
    if (assets.brandMark) ctx.drawImage(assets.brandMark, left, cy - mark / 2, mark, mark);
    ctx.font = `400 ${word}px ${assets.serif}`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Journey Photo", left + mark * 1.38, cy);
}

function handleOf(credit: StyleCredit): string {
    const u = credit.username?.trim().replace(/^@/, "") ?? "";
    return u ? "@" + u : "";
}

export function drawTate(ctx: CanvasRenderingContext2D, photo: CanvasImageSource, credit: StyleCredit,
    ratio: ShareCardRatio, assets: StyleAssets) {
    const L = tateLayout(ratio);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, L.height);
    drawCover(ctx, photo, 0, 0, 1080, L.height);
    shade(ctx, 1080, 0, 540, 0, { x: 540, y: 0, width: 540, height: L.height }, [[0, 0.62], [0.5, 0.28], [1, 0]]);
    shade(ctx, 0, L.bottomShadeTop, 0, L.height, { x: 0, y: L.bottomShadeTop, width: 1080, height: L.height - L.bottomShadeTop },
        [[0, 0], [0.5, 0.3], [1, 0.6]]);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 18;
    const { big, sub } = credit.place;
    let size = L.placeFontSize;
    let sealTop = L.placeTop;
    if (big) {
        const room = L.columnBottom - L.placeTop - L.sealGap - L.sealSize;
        if (isUprightVertical(big)) size = L.fittedPlaceSize([...big].length);
        else while (size > L.placeMinimumFontSize && verticalLength(ctx, big, size, L.placeStep, assets.mincho) > room) size -= 2;
        let place = big;
        while ([...place].length > 1 && verticalLength(ctx, place, size, L.placeStep, assets.mincho) > room) {
            place = [...place].slice(0, place.endsWith("…") ? -2 : -1).join("") + "…";
        }
        const cx = L.rightEdge - size / 2;
        sealTop = L.placeTop + drawVertical(ctx, place, cx, L.placeTop, size, L.placeStep, "#fff", assets.mincho) + L.sealGap;
        const subX = cx - size / 2 - L.columnGap - L.subFontSize / 2;
        let y = L.placeTop + size * 0.2;
        if (sub) {
            let subSize = L.subFontSize;
            while (subSize > 32 && y + verticalLength(ctx, sub, subSize, L.subStep, assets.mincho) > L.columnBottom) subSize -= 2;
            y += drawVertical(ctx, sub, subX, y, subSize, L.subStep, "#fff", assets.mincho) + subSize * 0.8;
        }
        if (credit.taken) {
            const text = isUprightVertical(big) ? kanjiYearMonth(credit.taken) : englishMonthYear(credit.taken);
            if (y + verticalLength(ctx, text, L.dateFontSize, L.dateStep, assets.mincho) <= L.columnBottom) {
                drawVertical(ctx, text, subX, y, L.dateFontSize, L.dateStep, "rgba(255,255,255,.9)", assets.mincho);
            }
        }
    }
    // 落款（白い角印。撮影者の頭文字）
    const seal = L.sealSize;
    ctx.translate(L.rightEdge - size / 2, sealTop + seal / 2);
    ctx.rotate(-0.04);
    ctx.strokeStyle = "rgba(255,255,255,.92)"; ctx.lineWidth = 5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-seal / 2, -seal / 2, seal, seal, 6); else ctx.rect(-seal / 2, -seal / 2, seal, seal);
    ctx.stroke();
    const initial = (credit.name.trim()[0] ?? "J").toUpperCase();
    ctx.font = `700 ${seal * 0.6}px ${assets.mincho}`;
    ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(initial, 0, 3);
    ctx.restore();

    // 左下: @名（無ければ名前）とロゴ
    const who = handleOf(credit) || credit.name.trim();
    if (who) {
        const fitted = fitText(ctx, who, assets.sans, 600, L.usernameFontSize, 22, L.leftColumnWidth);
        ctx.font = `600 ${fitted.size}px ${assets.sans}`;
        ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(fitted.text, L.margin, L.usernameTop);
    }
    drawBrandRow(ctx, L.margin, L.brandCenterY, L.brandMarkSize, L.brandWordSize, assets);
}

let grainCanvas: HTMLCanvasElement | null = null;
function grain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (!grainCanvas) {
        const g = document.createElement("canvas");
        g.width = g.height = 180;
        const x = g.getContext("2d");
        if (!x) return null;
        const d = x.createImageData(180, 180);
        let seed = 42 >>> 0;
        const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
        for (let i = 0; i < d.data.length; i += 4) {
            const v = next() < 0.5 ? 60 : 255;
            d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
            d.data[i + 3] = next() * 16;
        }
        x.putImageData(d, 0, 0);
        grainCanvas = g;
    }
    return ctx.createPattern(grainCanvas, "repeat");
}

export function drawInstant(ctx: CanvasRenderingContext2D, photo: CanvasImageSource, credit: StyleCredit,
    ratio: ShareCardRatio, assets: StyleAssets) {
    const L = instantLayout(ratio);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1080, L.height);
    // 同じ写真をぼかして暗く敷く
    ctx.save();
    ctx.filter = "blur(40px) saturate(1.15)";
    drawCover(ctx, photo, -120, -120, 1320, L.height + 240);
    ctx.restore();
    ctx.filter = "none";
    ctx.fillStyle = `rgba(0,0,0,${1 - L.backdropBrightness})`;
    ctx.fillRect(0, 0, 1080, L.height);

    const P = L.paper;
    const mx = P.x + P.width / 2, my = P.y + P.height / 2;
    ctx.save();
    ctx.translate(mx, my); ctx.rotate(L.paperTiltDegrees * Math.PI / 180); ctx.translate(-mx, -my);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.7)"; ctx.shadowBlur = 44; ctx.shadowOffsetY = 16;
    ctx.fillStyle = PAPER; ctx.fillRect(P.x, P.y, P.width, P.height);
    ctx.restore();
    const light = ctx.createLinearGradient(P.x, P.y, P.x + P.width, P.y + P.height);
    light.addColorStop(0, "rgba(255,255,255,.35)"); light.addColorStop(1, "rgba(120,100,70,.10)");
    ctx.fillStyle = light; ctx.fillRect(P.x, P.y, P.width, P.height);
    const pattern = grain(ctx);
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(P.x, P.y, P.width, P.height); }
    drawCover(ctx, photo, L.photo.x, L.photo.y, L.photo.width, L.photo.height);
    ctx.strokeStyle = "rgba(0,0,0,.22)"; ctx.lineWidth = 2;
    ctx.strokeRect(L.photo.x + 1, L.photo.y + 1, L.photo.width - 2, L.photo.height - 2);

    const place = [credit.place.big, credit.place.sub].filter(Boolean).join(" ");
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    if (place) {
        const fitted = fitText(ctx, place, assets.mincho, 700, L.placeFontSize, L.placeMinimumFontSize, L.textWidth);
        ctx.font = `700 ${fitted.size}px ${assets.mincho}`;
        ctx.fillStyle = INK;
        ctx.fillText(fitted.text, L.photo.x, L.placeTop);
    }
    const meta = [credit.taken ? dottedDate(credit.taken) : "", handleOf(credit)].filter(Boolean).join("  ");
    if (meta) {
        const fitted = fitText(ctx, meta, assets.sans, 500, L.metaFontSize, 20, L.textWidth);
        ctx.font = `500 ${fitted.size}px ${assets.sans}`;
        ctx.fillStyle = "rgba(7,9,10,.62)";
        ctx.fillText(fitted.text, L.photo.x, L.metaTop);
    }
    assets.drawMap?.(ctx, L.map, INK);

    // テープ（紙の上端の真ん中・4° 傾ける・端はぎざぎざ）
    ctx.translate(mx, P.y + 4); ctx.rotate(L.tapeTiltDegrees * Math.PI / 180);
    const w = L.tape.width, h = L.tape.height;
    ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-w / 2 + w * i / 6, -h / 2 + (i % 2 ? 3 : -2));
    for (let i = 0; i <= 6; i++) ctx.lineTo(w / 2 - w * i / 6, h / 2 + (i % 2 ? -3 : 2));
    ctx.closePath();
    ctx.fillStyle = "rgba(232,222,196,.7)"; ctx.fill();
    if (pattern) { ctx.fillStyle = pattern; ctx.fill(); }
    ctx.restore();

    const rowWidth = brandRowWidth(ctx, L.brandMarkSize, L.brandWordSize, assets.serif);
    drawBrandRow(ctx, 540 - rowWidth / 2, L.brandCenterY, L.brandMarkSize, L.brandWordSize, assets);
    ctx.font = `400 ${L.addressFontSize}px ${assets.sans}`;
    ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText(SITE, 540, L.addressTop);
}

export { INK as SHARE_CARD_INK, PAPER as SHARE_CARD_PAPER };
