import { BTN_FILL } from "./buttonStyles";

/**
 * 設定の下の画面・ログイン・登録の入力欄と主ボタン（iOS `JPField`・板 `ChangePassword.dc.html`・2026-11-04）。
 *
 *     見出し  12・500・白72%（欄の上・間 6）
 *     欄      高さ 48・角 12（`rounded-field`）・地 surface-2・白14%の縁。字はタッチ端末で 16（globals の規則）
 *     主ボタン 写真の無い画面の主ボタン＝真鍮の塗り（accent-fill）に墨・高さ 50（`BTN_FILL`）・横いっぱい
 */
export const SETTINGS_LABEL_CLASS = "block mb-1.5 text-xs font-medium text-white/70";
export const SETTINGS_INPUT_CLASS =
    "w-full h-12 bg-surface-2 border border-line-strong rounded-field px-[14px] text-[15px] text-white placeholder-white/50 focus:outline-none focus:border-white/30 transition-colors disabled:opacity-60";
export const SETTINGS_PRIMARY_CLASS =
    `w-full inline-flex items-center justify-center gap-2 ${BTN_FILL} bg-accent-fill text-ink hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;

/**
 * 写真のある画面（ログイン・登録）の主ボタンは**白**に墨（iOS `SignInLayout.primaryStyle = .main(onPhoto: true)`・
 * CLAUDE.md の owner の好み「写真のある画面の主ボタンは白」）
 */
export const AUTH_PRIMARY_CLASS =
    `[@media(max-height:720px)]:min-h-12 w-full inline-flex items-center justify-center gap-2 ${BTN_FILL} bg-white text-ink hover:bg-white/90 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;
/**
 * 写真の無い黒地の主ボタン（デザインの板 accent-fill: 真鍮の塗りに墨）。形は `AUTH_PRIMARY_CLASS` と同じ。
 * 登録の頁を「行きたい」から開いた回（2026-11-24・#432）。写真の帯の上ではなく黒地の上に置く
 */
export const AUTH_ACCENT_PRIMARY_CLASS =
    `w-full inline-flex items-center justify-center gap-2 ${BTN_FILL} bg-accent-fill text-ink hover:brightness-110 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg`;
/** 2番手の線のボタン（iOS `.outline`・白28%の縁・高さ 50） */
export const AUTH_OUTLINE_CLASS =
    `[@media(max-height:720px)]:min-h-11 w-full inline-flex items-center justify-center gap-2 ${BTN_FILL} bg-transparent text-white ring-1 ring-inset ring-white/30 hover:bg-white/10 active:scale-[0.98] transition disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`;
/** 文字だけのボタン（「パスワードを忘れた」・13・白72%・当たり 44） */
export const AUTH_TEXT_BUTTON_CLASS =
    "inline-flex items-center min-h-[44px] text-[13px] text-white/70 hover:text-white transition-colors disabled:opacity-40";
/** 欄の下の注記（12・白60%） */
export const AUTH_CAPTION_CLASS = "m-0 text-xs leading-relaxed text-white/60";

/**
 * ログインと登録の本文の頭（写真の帯の上からロゴまで）。390×844 では iOS と同じ 142、背の低い画面ほど詰めて最小 96
 * （2026-11-25 owner の写真: iPhone の Safari は上下の帯で見える高さが約 664 しかなく、欄とログインのボタンが下のタブに隠れていた）。
 * 見える高さ（`svh`＝Safari の帯が出ているときの高さ）− 702 で、844 で 142・798 以下で 96
 */
export const AUTH_TOP_PAD_CLASS = "pt-[clamp(96px,calc(100svh_-_702px),142px)] [@media(max-height:720px)]:pt-16";

/**
 * 背の低い画面（見える高さ 720 以下・iPhone の Safari の約 664、375×667 など）の詰めた形（2026-11-25 owner の写真）。
 * iOS `SignInLayout` の compact／tight と同じ考えで、開いた直後に「ログイン」と「アカウントを作る」まで見えるようにする。
 * 行の間 12 → 8、欄 48 → 44、主ボタン 50 → 48、線のボタン 50 → 44、ロゴの上 96 → 64、「またはメールアドレスで」の線は消す（iOS の tight）。
 * 字の大きさと押せる大きさ（44 以上）は変えない
 */
export const AUTH_STACK_CLASS = "flex flex-col gap-3 [@media(max-height:720px)]:gap-2";
export const AUTH_INPUT_CLASS = `${SETTINGS_INPUT_CLASS} [@media(max-height:720px)]:h-11`;
