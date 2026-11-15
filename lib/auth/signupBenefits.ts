/**
 * **登録するとできること**（札 journey.photo-ios#618「離脱防止」の案1・2026-11-15）。
 *
 * 2026-11-15 判断（owner「アカウント登録画面は何も変えたくない」→ 案C）: 登録の頁（`app/signup`）と
 * ログインの頁（`app/login`）は変えない。**ログインしていない人に、トップの並びの途中と写真の頁で、
 * 控えめな案内（札4枚）を出す**（`app/components/SignUpBenefits.tsx`）。押した先は今の `/signup` と `/login` のまま。
 *
 * 4枚は輪の順（載せる → 行きたい場所 → 旅行プランを仲間と → 話す）。iOS のホームの段
 * （`SignUpBenefit`、`HomeSignUpBenefitsView`）と同じ字、同じ順にそろえる。中黒で区切らない。
 */
import { ROUTES, loginWithNext } from "../routes";

export type SignUpBenefitId = "post" | "wantToGo" | "tripPlan" | "message";

export const SIGNUP_BENEFITS: ReadonlyArray<{ id: SignUpBenefitId; ja: string; en: string }> = [
    { id: "post", ja: "写真を載せる", en: "Post photos" },
    { id: "wantToGo", ja: "行きたい場所を保存", en: "Save places to go" },
    { id: "tripPlan", ja: "旅行プランを仲間と作る", en: "Plan trips with friends" },
    { id: "message", ja: "メッセージで話す", en: "Chat in messages" },
];

export const SIGNUP_BENEFITS_HEADING = { ja: "登録するとできること", en: "What you can do with an account" } as const;
/** 札の下の2つ（押した先は今の登録の頁とログインの頁） */
export const SIGNUP_BENEFITS_SIGNUP = { ja: "新規登録", en: "Sign up" } as const;
export const SIGNUP_BENEFITS_LOGIN = { ja: "ログイン", en: "Log in" } as const;

/** トップの並びで、ひと回り（大きく1枚 → 2枚 → 2枚 ＝ 5枚）の後ろに出す（iOS と同じ位置） */
export const SIGNUP_BENEFITS_AFTER_INDEX = 4;

type Via = Parameters<typeof loginWithNext>[1];

/**
 * 札と「新規登録」の行き先。今いる頁へ戻れるよう `next` を添える（登録の頁が前から読む値）。
 * `via`（登録までの数え方）はログインの頁へ渡すときと同じ形で運ぶ（許可リストは `loginWithNext` のもの）
 */
export function signupBenefitsSignupHref(currentPath?: string | null, via?: Via): string {
    // ログインの頁への行き先（`/login?next=…&via=…`）と同じ問いを、登録の頁へ向ける
    return ROUTES.SIGNUP + loginWithNext(currentPath, via).slice(ROUTES.LOGIN.length);
}

/** 「ログイン」の行き先（今のログインの頁へ。戻り先つき） */
export function signupBenefitsLoginHref(currentPath?: string | null, via?: Via): string {
    return loginWithNext(currentPath, via);
}

/**
 * ログインのお願い（空の頁、フォロー中の並び、未ログインの反応の知らせ）に並べる2つ（札 journey.photo-ios#630、2026-11-15）。
 * **新規登録が主（`action`）、ログインが隣（`secondaryAction`）。** 本番の会員は約7人（Cognito の見積もり）で、
 * お願いを見る人の多くはまだ登録していない。押した先は今の登録の頁とログインの頁のまま（戻り先と via を運ぶ）
 */
export function signInAskActions(locale: string, currentPath?: string | null, via?: Via): {
    action: { label: string; href: string };
    secondaryAction: { label: string; href: string };
} {
    const isJa = locale !== "en";
    return {
        action: { label: isJa ? SIGNUP_BENEFITS_SIGNUP.ja : SIGNUP_BENEFITS_SIGNUP.en, href: signupBenefitsSignupHref(currentPath, via) },
        secondaryAction: { label: isJa ? SIGNUP_BENEFITS_LOGIN.ja : SIGNUP_BENEFITS_LOGIN.en, href: signupBenefitsLoginHref(currentPath, via) },
    };
}

/** 出すか。**ログインの確かめが終わって、ログインしていないと分かってから**（確かめ中にログイン済みの人へ一瞬出さない） */
export function showsSignupBenefits(auth: { loading: boolean; isAuthenticated: boolean }): boolean {
    return !auth.loading && !auth.isAuthenticated;
}
