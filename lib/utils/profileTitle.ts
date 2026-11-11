/**
 * 公開プロフィール（`/users/<id>`）の題とユーザー名の扱い。
 *
 * **2026-11-11 判断（journey.photo-ios#525・owner の要望）:**
 * 「<ユーザー名> journey photo」「<表示名> journey photo」で探されたときに、
 * その人のプロフィールが上に出るようにする。それまでユーザー名は JS が
 * プロフィール API を読んだあとにしか出ず、本番の最初の HTML には1回も
 * 入っていなかった（`ryuhei` の頁を curl で確認、0回）。
 *
 * 題は Instagram の「名前 (@ハンドル)」と同じ並び。名前を先頭に置き、
 * サイト名は短い「Journey Photo」だけにする（親の template の
 * 「Journey Photo 旅フォトギャラリー」だと名前の後ろが長く、検索結果で
 * `@ユーザー名` が切られやすい）。
 */

/**
 * ユーザー名をサーバーの決まり（`api-user/src/userProfile.ts` の
 * `USERNAME_RE`: 英小文字・数字・_ の3〜20文字）に合うものだけ通す。
 * title・JSON-LD に自由文字列を混ぜない。`@` は付けずに返す。
 */
export function safeUsername(raw: string | undefined | null): string | undefined {
    const v = (raw ?? "").trim().replace(/^@/, "").toLowerCase();
    return /^[a-z0-9_]{3,20}$/.test(v) ? v : undefined;
}

/** `表示名（@ユーザー名）`、ユーザー名が無ければ `表示名` */
export function profileWho(displayName: string, username: string | undefined): string {
    return username ? `${displayName}（@${username}）` : displayName;
}

/** `表示名（@ユーザー名）の写真 | Journey Photo`（ユーザー名が無い人は `表示名の写真 | Journey Photo`） */
export function profileTitle(displayName: string, username: string | undefined): string {
    return `${profileWho(displayName, username)}の写真 | Journey Photo`;
}
