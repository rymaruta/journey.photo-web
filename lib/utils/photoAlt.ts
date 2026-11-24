// lib/utils/photoAlt.ts
// 写真の代替テキスト（alt）を1か所で組む。

import { getLocalized, type Photo, type Locale } from "../data/photos";
import { photoOwnTitle, photoTitleFor } from "./photoTitle";
import { metaPlace, titlePlaceTail } from "./metaPlace";

/**
 * 写真の alt。**画像検索に出るかどうかは、ほぼここで決まる。**
 *
 * ## なぜ1本にしたか
 *
 * 撮影地を併記する形は `GalleryGrid`（一覧のサムネ）**だけ**に入っていて、
 * **写真ページの本体画像・モーダル・OGP は素の題のまま**だった。
 * 画像検索が実際に見て順位を付けるのは**本体画像**の方なので、
 * 効かせたい1枚にだけ効いていなかった（この台帳が何度も記録している
 * 「入口が2つあるのに片方しか直っていない」）。
 *
 * ## 組み方
 *
 * 1. 利用者が書いた `alt` があれば**それをそのまま使う**（人が書いたものが最優先）
 * 2. 無ければ題。題に撮影地が入っていなければ `（撮影地）` を添える
 * 3. 題も無ければ撮影地だけ
 * 4. 撮影地も無ければ写真ページと同じ代わりの題（「写真」/ Photo・`photoTitleFor`）
 *    ——空の alt だと、写真ページ本体の2枚目以降が「（2/3）」だけになり、
 *    画像検索が見る本体画像が名前を持たない（2026-10-18）
 *
 * **水増しはしない。** タグやカテゴリを並べて長くすると、alt は
 * 「画像の説明」ではなく検索語の羅列になり、支援技術の読み上げも壊れる。
 * 実データ30枚は alt を持つのが2枚だけ・題の中央値が8文字なので、
 * 地名を1つ足すだけで「未完の大聖堂」が「未完の大聖堂（バルセロナ）」になる。
 */
export function photoAltText(photo: Photo, locale: Locale): string {
    const own = getLocalized(photo.alt, locale);
    if (own) return own;

    // サーバーが入れていた「無題」は題として扱わない（`photoTitle.ts`）。
    // 読み上げと画像検索に「無題」と言わせない
    // 言語ごとに「無題」を落とす（`{ ja: "無題", en: "Sunset" }` で h1・一覧と割れない）
    const title = photoOwnTitle(photo, locale);
    const place = typeof photo.location === "string" ? photo.location.trim() : "";
    // **並べ方の決め方は `titlePlaceTail`（`metaPlace.ts`）1つに置く**（写真ページの `<title>` と
    // 同じ判断。片方だけ直して `alt="オペラ・ガルニエ（オペラ・ガルニエ（パリ））"` を19ページに出した）。
    // 2026-11-09: 撮影地は住所の全文でなく「名前（市区町村）」まで（og:image の alt も同じ経路）。
    // ここが決めるのは「（）でつなぐ」ことだけ。題が無ければ代わりの題（`photoTitleFor`）
    const mp = metaPlace(place);
    // 題が無ければ撮影地の名前だけ（住所の全文は出さない）。名前も無ければ代わりの題
    if (!title) return mp.head || photoTitleFor(photo, locale).text;
    // alt の括弧は1段（「海（名前、市区町村）」）。入れ子の括弧は読み上げが重い
    const tail = titlePlaceTail(title, mp).replace(/（(.+)）$/, "、$1");
    return tail ? `${title}（${tail}）` : title;
}

/**
 * 回遊リンク（関連写真の帯・近くの写真）の画像の alt（2026-10-22）。
 * `photoAltText`（alt → 題（撮影地）→「撮影地の写真」）で、それも決まり文句の「写真」「Photo」しか
 * 残らないときだけ、呼ぶ側が知っている文脈（「luzhjさんの写真」）に替える
 */
export function relatedPhotoAlt(photo: Photo, locale: Locale, fallback?: string): string {
    // 題か alt があれば写真ページの本体と同じ組み立て（`photoAltText`）。どちらも無ければ
    // 代わりの題（「板橋区の写真」・`photoTitleFor`）——撮影地の生の文字列（「板橋区, 日本」）を alt にしない
    const hasOwn = Boolean(getLocalized(photo.alt, locale) || photoOwnTitle(photo, locale));
    const text = hasOwn ? photoAltText(photo, locale) : photoTitleFor(photo, locale).text;
    const generic = text === "" || text === "写真" || text === "Photo";
    return generic && fallback?.trim() ? fallback.trim() : text;
}
