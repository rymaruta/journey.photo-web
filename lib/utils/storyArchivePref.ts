// lib/utils/storyArchivePref.ts
//
// ストーリーを作る画面の「アーカイブに自動保存」を、人ごとに端末に覚える（DOM を持たない・保存は try/catch）。
//
// 2026-11-11 判断（owner「最初からオンでいい」・iOS の `StoryArchivePreference` とそろえる）:
//   - **最初の値はオン。** 前は開くたびにオフから始まり、残したい人は毎回入れていた
//     （ハイライトに入れられるのは残したものだけ・`api-user/src/highlights.ts`）
//   - **最後に選んだ値を人ごとに覚える。** 一度オフにした人は次もオフで始まる。
//     前は閉じるたびにオフへ戻していた（「一度切った人の次の投稿が黙って同じ設定で出る」を避けるため）が、
//     既定がオンになったので、オフを選んだ人が毎回切ることになる。戻すのは「その人が最後に選んだ値」
//   - ログインしていない（`userId` が無い）ときは覚えない・読まない（オン）
//   - 退会したら消す（`removeStoryArchiveUserData`）
//   - 保存できない環境（プライベートモードなど）でも動く（毎回オン）

export const STORY_ARCHIVE_KEY = "jp_story_archive";
/** 覚えが無いときの値（2026-11-11 判断: オン） */
export const STORY_ARCHIVE_DEFAULT = true;

const keyFor = (userId: string) => `${STORY_ARCHIVE_KEY}:${userId}`;

/** その人が最後に選んだ値。覚えが無い・持ち主が分からない・読めなければオン */
export function readStoryArchive(userId: string | null | undefined): boolean {
    if (!userId) return STORY_ARCHIVE_DEFAULT;
    try {
        const v = window.localStorage.getItem(keyFor(userId));
        if (v === "1") return true;
        if (v === "0") return false;
        return STORY_ARCHIVE_DEFAULT;
    } catch {
        return STORY_ARCHIVE_DEFAULT;
    }
}

/** 選んだ値を覚える。持ち主が分からなければ書かない */
export function writeStoryArchive(userId: string | null | undefined, keep: boolean): void {
    if (!userId) return;
    try { window.localStorage.setItem(keyFor(userId), keep ? "1" : "0"); } catch { /* 保存できなくても動く */ }
}

/** 退会した人の控えを消す（同じ userId では二度とログインできない） */
export function removeStoryArchiveUserData(userId: string): void {
    try { window.localStorage.removeItem(keyFor(userId)); } catch { /* ignore */ }
}
