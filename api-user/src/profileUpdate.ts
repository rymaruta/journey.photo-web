import { updateMyProfile as updateMyProfileCore, setStaticChangeHook } from "./userProfile";
import { requestSiteRebuild } from "./rebuild";

/**
 * `PUT /user/profile` の Lambda の入口（serverless.yml の `updateMyProfile`）。
 *
 * **2026-11-11 判断（journey.photo-ios#525）:** 静的な `/users/<id>` の title・説明・
 * `@ユーザー名`・構造化データは、ビルド時に users テーブルから引く
 * （`scripts/sync-photos-from-ddb.js`）。それまでプロフィールの保存は再ビルドを
 * 頼んでいなかったので、**名前を変えても、誰かが次に投稿・編集するまで検索に
 * 出る頁は古い名前のまま**だった。
 *
 * 何度でも無料で起こせる操作なので `coalesce`（10分に1回へ束ねる）。月の上限
 * （`REBUILD_MONTHLY_MAX`）も `requestSiteRebuild` が持つ。失敗しても保存は
 * 成功のまま返す（`requestSiteRebuild` は投げない）。
 *
 * **例外: 「検索エンジンに表示しない」をオンにした回は束ねない**（#526・確かめ役 2026-11-11）。
 * 束ねて見送られた依頼は後から実行されないので、直前に誰かの保存があると、隠したつもりの
 * 頁が次の誰かの保存まで noindex にならず sitemap にも残る。プライバシーの操作なので確実に頼む。
 * オフに戻す・名前を変えるなどは今までどおり束ねる。月の上限は束ねなくても効く。
 *
 * 依頼をこのファイルに分けた理由は `userProfile.ts` の `setStaticChangeHook` の注記。
 */
setStaticChangeHook((userId, { becameSearchHidden }) => becameSearchHidden
    ? requestSiteRebuild(`profile hidden from search: ${userId}`)
    : requestSiteRebuild(`profile updated: ${userId}`, { coalesce: true }));

export const updateMyProfile = updateMyProfileCore;
