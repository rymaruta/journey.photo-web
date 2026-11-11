import { deriveUploadKey, mediaKeys } from "./mediaKeys";

/**
 * ギャラリーに残したストーリー（`storyKeep.ts`）と写真が、**S3 の画像を共有しているか**。
 *
 * 残し方は2つある:
 *
 *     生きている普通のストーリー   画像を**共有**する（`keptAs` だけ）。写真を消すと
 *                                 `deleteMyPhoto` の `keptFrom` がストーリーの行ごと消す
 *     自分用に残すストーリー        画像を**写して切り離す**（`keptAs` ＋ `keptCopy`）。
 *     （`archive: true`）           写真に `keptFrom` を付けない——どちらを消しても、
 *                                 もう片方は残る
 *
 * 2026-11-11 判断（owner 承認「いいよ」）: 自分用に残す（アーカイブ）が既定でオンになり、
 * 「写真として残す」が多くの人から消えるので、アーカイブのストーリーは写して切り離す。
 * 画像は1枚ぶん増える（承認済み）。生きている普通のストーリーの作りは変えない。
 *
 * **消すときの約束**（`storyKeptMedia.test.ts` が縛る）:
 *   - ストーリーを消す → ストーリーの画像だけ消え、写真は残る
 *   - 写真を消す → 写真の画像だけ消え、ストーリーは残る
 *   - どちらを消しても、画像が S3 に置き去りにならない
 *   - 退会で両方とも消える
 *   - 期限で消える普通のストーリーの掃除は、写した写真の画像を消さない
 */

/** 写した画像の名前の頭（同じストーリーからは必ず同じ鍵＝押し直しても2枚にならない） */
export const KEPT_COPY_PREFIX = "kept-";

/**
 * ストーリーの画像の鍵から、写す先の鍵を作る（同じ置き場・名前の頭に `kept-`）。
 * `uploads/<uid>/<名前>` の形でなければ空（写さない）。**本人の置き場から出ない**——
 * 写した写真の画像も、削除・退会の `mediaKeys` がそのまま拾える
 */
export function keptCopyKey(storyKey: string): string {
    if (!storyKey.startsWith("uploads/") || storyKey.includes("..")) return "";
    const slash = storyKey.lastIndexOf("/");
    const name = storyKey.slice(slash + 1);
    if (slash <= "uploads/".length - 1 || !name) return "";
    return `${storyKey.slice(0, slash + 1)}${KEPT_COPY_PREFIX}${name}`;
}

/**
 * 画像の URL の道（パス）だけを、別の鍵に差し替える（ホストはそのまま）。
 * 鍵は1段ずつ URL エンコードする（`canonicalUploadUrl` と同じ形）
 */
export function urlWithKey(src: string, key: string): string {
    try {
        const u = new URL(src);
        return `${u.origin}/${key.split("/").map(encodeURIComponent).join("/")}`;
    } catch {
        return "";
    }
}

/**
 * このストーリーの画像は、残した写真と**共有**しているか（＝ストーリー側で消してはいけないか）。
 * `keptAs` があっても `keptCopy` なら写しなので共有していない（ストーリーの画像は消してよい）。
 * `api/src/photosMutate.ts` の管理者の削除が同じ判定を持つ（**対**）
 */
export function sharesKeptMedia(item: Record<string, unknown>): boolean {
    return typeof item.keptAs === "string" && !!item.keptAs && item.keptCopy !== true;
}

/**
 * ストーリーの行が持つ画像の鍵（共有しているかは見ない）。原本（`key` / `src`）と派生の全部。
 * `stories.ts` の `storyMediaKeys` と、写真を消すときに元のストーリーも一緒に消す
 * `photoUpdate.ts` の `deleteMyPhoto` が使う（**列挙は1か所**）
 */
export function storyOwnMediaKeys(item: Record<string, unknown>): string[] {
    const keys = new Set(mediaKeys(item));
    // `key` を優先、無ければ `src` の道から（`deriveUploadKey` はデコードしてから見る）
    const primary = typeof item.key === "string" && item.key ? deriveUploadKey(item.key) : deriveUploadKey(item.src);
    if (primary) keys.add(primary);
    return [...keys];
}
