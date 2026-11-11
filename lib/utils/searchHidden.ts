import PROFILES from "@/app/data/profiles.json";

/**
 * 「検索エンジンにプロフィールを表示しない」を選んだ人か（2026-11-11 owner 承認・journey.photo-ios#526）。
 *
 * 材料はビルド時の `app/data/profiles.json`（`scripts/sync-photos-from-ddb.js` が users テーブルの
 * `searchHidden` を、true のときだけ書き出す。読めなかった人も true に倒してある）。
 * 選んだ人の `/users/<id>` は noindex・sitemap から外す・構造化データを出さない。
 * 写真そのものは公開のまま（写真ごとの公開・非公開は別の設定）。
 */
export function isSearchHidden(userId: string): boolean {
    return (PROFILES as Record<string, { searchHidden?: unknown }>)[userId]?.searchHidden === true;
}
