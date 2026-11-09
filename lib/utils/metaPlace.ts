/**
 * **検索結果・SNS に出す題と説明のための、撮影地の短い言い方**（2026-11-09・Web 入口ページ監査の案A）。
 *
 * 写真の撮影地（`photo.location`）は、地図から引いた住所がそのまま入っていることがある:
 *
 *     ひろめ市場, 追手筋, 追手筋一丁目, 廿代町, 高知市, 高知県, 780-8571, 日本
 *
 * これを `<title>`・og:title・description に出すと、検索結果で「住所の羅列」に見える
 * （本番の写真ページの実値。郵便番号・番地・町名が並ぶ）。人が読んで場所が伝わるのは
 * **場所の名前（いちばん具体的な所）と、市区町村まで**。ここはその2つだけを取り出す。
 *
 * 取り方（データは変えない・表示用）:
 *   - 名前 `head`  … カンマ区切りなら先頭（地図の住所は小さい所から並ぶ）。空白区切りの
 *                    「県 市 場所」型は `placeParts` の見出し（いちばん具体的な所）
 *   - 市区町村 `area` … 市 → 海外の都市 → 区 → 町村（次が郡・県のときだけ。「廿代町」のような
 *                    町名を拾わない）の順。名前と同じものは取らない
 *   - 都道府県 `pref` … 説明で「高知県高知市」と言うときだけ使う
 *
 * `placeParts` と同じく、台帳の地域名の表に頼る。**切れない文字列は名前をそのまま返す**
 * （「山中湖」「パリ」は `head` だけ・`area` は空）。
 */
import { placeParts, areaKind, PREFECTURES } from "./placeName";

export type MetaPlace = { head: string; area: string; pref: string };

const CITY = /^[^\s]{1,8}市$/;
const WARD = /^[^\s]{1,8}区$/;
const TOWN = /^[^\s]{1,8}(町|村)$/;
const GUN = /^[^\s]{1,8}郡$/;
const PREF_SET: ReadonlySet<string> = new Set(PREFECTURES);

const EMPTY: MetaPlace = { head: "", area: "", pref: "" };

/** 括弧の中（「オペラ・ガルニエ（パリ）」）は外へ出す */
function stripParen(raw: string): { text: string; inner: string } {
    const m = raw.match(/^(.+?)\s*[（(]([^（）()]+)[）)]$/);
    return m ? { text: m[1].trim(), inner: m[2].trim() } : { text: raw, inner: "" };
}

function pickArea(tokens: string[], head: string): string {
    const rest = tokens.filter((t) => t !== head);
    const city = rest.find((t) => CITY.test(t));
    if (city) return city;
    const overseas = rest.find((t) => areaKind(t) === "municipality" && !WARD.test(t) && !TOWN.test(t));
    if (overseas) return overseas;
    const ward = rest.find((t) => WARD.test(t));
    if (ward) return ward;
    // 町・村は、次が郡か県のときだけ（住所の途中の「廿代町」のような町名を拾わない）
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === head || !TOWN.test(t)) continue;
        const next = tokens[i + 1] ?? "";
        if (GUN.test(next) || PREF_SET.has(next)) return t;
    }
    return "";
}

export function metaPlace(location: unknown): MetaPlace {
    const full = typeof location === "string" ? location.trim() : "";
    if (!full) return EMPTY;
    const { text, inner } = stripParen(full);
    const commaStyle = /[,、，]/.test(text);
    let head: string;
    let tokens: string[];
    if (commaStyle) {
        tokens = text.split(/[,、，]+/).map((t) => t.trim()).filter(Boolean);
        head = tokens[0] ?? "";
    } else {
        const p = placeParts(text);
        head = p.title;
        tokens = [...p.context.split(/[\s　]+/).filter(Boolean), head];
    }
    if (inner) tokens.push(...inner.split(/[\s　,、，]+/).filter(Boolean));
    if (!head) return EMPTY;
    const area = pickArea(tokens, head);
    const pref = tokens.find((t) => t !== head && PREF_SET.has(t)) ?? "";
    return { head, area, pref };
}

/**
 * 題の後ろに足す撮影地（「題｜ここ」）。**題に入っている言葉は足さない**:
 *   題が名前を含む → 市区町村だけ（無ければ足さない）
 *   含まない       → 名前（市区町村があれば「名前（市区町村）」）
 */
export function titlePlaceTail(title: string, place: MetaPlace): string {
    const t = title ?? "";
    const { head, area } = place;
    if (!head) return "";
    const areaNew = area && !t.includes(area) ? area : "";
    if (t.includes(head)) return areaNew;
    return areaNew ? `${head}（${areaNew}）` : head;
}

/**
 * 書かれた説明の後ろに括弧で足す撮影地。**説明に入っている言葉は足さない**。
 * 地域は「高知県高知市」のように県から言う（検索語に当たる）。
 */
export function descriptionPlaceTail(description: string, place: MetaPlace): string {
    const d = description ?? "";
    const { head, area, pref } = place;
    if (!head) return "";
    const parts: string[] = [];
    if (!d.includes(head)) parts.push(head);
    const regionKey = area || pref;
    if (regionKey && !d.includes(regionKey)) {
        parts.push(area ? `${pref}${area}` : pref);
    }
    return parts.join("・");
}

/** 説明を組み立てるときの「<ここ>で撮影した」の撮影地（名前と市区町村） */
export function placeForSentence(place: MetaPlace): string {
    const { head, area } = place;
    if (!head) return "";
    return area ? `${head}（${area}）` : head;
}
