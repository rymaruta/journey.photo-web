/**
 * **登録するとできること**（札 journey.photo-ios#618「離脱防止」の案1・2026-11-15）。
 *
 * 2026-11-15 判断（owner「アカウント登録画面は何も変えたくない」→ 案C）: 登録の頁（`app/signup`）と
 * ログインの頁（`app/login`）は変えない。**ログインしていない人に、トップの並びの途中と写真の頁で、
 * 控えめな案内（札4枚）を出す**（`app/components/SignUpBenefits.tsx`）。押した先は今の `/signup` と `/login` のまま。
 *
 * 4枚は輪の順（載せる → 行きたい場所 → AI で旅行プラン → 話す）。iOS のホームの段
 * （`SignUpBenefit`、`HomeSignUpBenefitsView`）と同じ字、同じ順にそろえる。中黒で区切らない。
 */
import { ROUTES, loginWithNext, safeNextPath } from "../routes";

export type SignUpBenefitId = "post" | "wantToGo" | "tripPlan" | "message";

export const SIGNUP_BENEFITS: ReadonlyArray<{ id: SignUpBenefitId; ja: string; en: string }> = [
    { id: "post", ja: "写真を載せる", en: "Post photos" },
    { id: "wantToGo", ja: "行きたい場所を保存", en: "Save places to go" },
    // 2026-11-15（札 journey.photo-ios#621・owner「AI の旅行プランを登録の入口に」）: 「旅行プランを仲間と作る」と入れ替えた。
    // 5枚だと2列で1枚余る。iOS の `SignUpBenefit.tripPlan` と同じ字。識別子は変えない
    { id: "tripPlan", ja: "AI で旅行プランを作る", en: "Plan trips with AI" },
    { id: "message", ja: "メッセージで話す", en: "Chat in messages" },
];

export const SIGNUP_BENEFITS_HEADING = { ja: "登録するとできること", en: "What you can do with an account" } as const;
/** 札の下の2つ（押した先は今の登録の頁とログインの頁） */
export const SIGNUP_BENEFITS_SIGNUP = { ja: "新規登録", en: "Sign up" } as const;
export const SIGNUP_BENEFITS_LOGIN = { ja: "ログイン", en: "Log in" } as const;

/** トップの並びで、ひと回り（大きく1枚 → 2枚 → 2枚 ＝ 5枚）の後ろに出す（iOS と同じ位置） */
export const SIGNUP_BENEFITS_AFTER_INDEX = 4;

/** 札と「新規登録」の行き先。今いる頁へ戻れるよう `next` を添える（登録の頁が前から読む値） */
export function signupBenefitsSignupHref(currentPath?: string | null): string {
    const safe = safeNextPath(currentPath);
    return safe ? `${ROUTES.SIGNUP}?next=${encodeURIComponent(safe)}` : ROUTES.SIGNUP;
}

/** 「ログイン」の行き先（今のログインの頁へ。戻り先つき） */
export function signupBenefitsLoginHref(currentPath?: string | null): string {
    return loginWithNext(currentPath);
}

/** 出すか。**ログインの確かめが終わって、ログインしていないと分かってから**（確かめ中にログイン済みの人へ一瞬出さない） */
export function showsSignupBenefits(auth: { loading: boolean; isAuthenticated: boolean }): boolean {
    return !auth.loading && !auth.isAuthenticated;
}
