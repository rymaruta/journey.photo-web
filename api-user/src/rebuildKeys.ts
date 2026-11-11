/**
 * 再ビルドの急ぎの印（`rebuild.ts` の `urgentKey`）の鍵と行の ID（#526）。
 *
 * `rebuild.ts` とは分けて置く: あちらは `api` と同じ内容の写しで、多くの試験が丸ごと差し替える。
 * ここは依存の無い小さな関数だけなので、退会の掃除（`account.ts`）と保存（`profileUpdate.ts`）が
 * 差し替えの影響を受けずに同じ鍵を使える。行の ID は `rebuild.ts` の `rebuild#<鍵>` と同じ形
 * （`rebuild.test.ts` が突き合わせる）。
 */

/** 「検索エンジンに表示しない」をオンにした回の急ぎの鍵。行は `rebuild#hidden#<uid>`。退会で消す */
export const searchHiddenUrgentKey = (userId: string) => `hidden#${userId}`;

/** 急ぎの鍵の印を置く行の ID（`rebuild.ts` の `requestSiteRebuild` が書く行） */
export const urgentRowId = (key: string) => `rebuild#${key}`;
