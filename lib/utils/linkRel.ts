// lib/utils/linkRel.ts
//
// リンクの rel の決まり。画面の部品から読むので、重い seo.ts とは分けて置く。

/**
 * **利用者が書いたリンクの rel**（2026-11-25）。プロフィールの Web サイト、マイBGM の曲の頁など、
 * 利用者が自分で入れた行き先には `ugc nofollow` を付ける（Google の「外部リンクに適切な属性を付ける」。
 * 運営が確かめていないリンクに、このサイトの評価を渡さない。スパムの的にもしない）。
 * 新しいタブで開くので `noopener noreferrer` も持つ
 */
export const UGC_LINK_REL = "ugc nofollow noopener noreferrer";
