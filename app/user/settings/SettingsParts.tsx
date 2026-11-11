"use client";

/**
 * **設定とその下の画面の部品**（iOS の `SettingsPage`・`SettingsGroup`・`JPRowLabel`・`SettingsActionLabel`、
 * 板 `Settings.dc.html`・2026-11-04 に iOS の今の形へそろえた）。
 *
 *     画面   左寄せの明朝 30 の大見出し（左右 4 の内側）→ 節と節の間 32
 *     節     真鍮の眉ラベル（11・600・字間 0.14em・大文字）→ 8 → 札
 *     札     地 #0E0E0F・白8%の縁・角 16（`CARD`）。行と行の間は白8%の線
 *     行     最小 54・上下 13・左右 14・間 12。名前 15/20 → 説明 12（白60%）→ 右に値（13・等幅数字）と ›
 *
 * - 行の絵は出さない（板 v2: Pro の行の Pro マークだけ。Web は Pro を売らないのでその行も無い）
 * - 危ない行（アカウントの削除）は名前ごと danger（#F0565A）。**系統の赤は使わない**
 * - 下の画面（ブロックした人など）も同じ入れ物（`SettingsShell`）で組む——iOS の `SettingsPage` と同じ
 */

import React from "react";
import Link from "next/link";
import { ArrowLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../../auth/context";
import { useLocale } from "../../i18n/context";
import { useLoginRedirect } from "../../../lib/hooks/useLoginRedirect";
import { LoadingState } from "../../components/StateViews";
import { CARD, ROW_CHEVRON } from "../../components/rowStyles";
import { ROUTES } from "../../../lib/routes";

/** 寸法（iOS `SettingsLayout`・`JPRowLabel`）。テストで見張る */
export const SETTINGS_LAYOUT = {
    /** 大見出し（明朝 30・iOS `SettingsLayout.titleSize`） */
    titleSize: 30,
    /** 節と節の間（`JPSpace.section`） */
    sectionGap: 32,
    /** 眉ラベルと札の間（`SettingsLayout.headerSpacing`） */
    headerGap: 8,
    /** 行の最小の高さ（`JPRowLabel` の `minHeight: 54`） */
    rowMinHeight: 54,
} as const;

/** 大見出し（明朝 30・700・行の高さ 1.3・左右 4）。iOS `JPFont.display(30)` は Shippori Mincho B1 **Bold** */
export const SETTINGS_TITLE_CLASS = "m-0 px-1 font-serif font-bold text-white text-[30px] leading-[1.3]";

/** 札（行を束ねる）。行の間に白8%の線 */
export const SETTINGS_CARD = `${CARD} flex flex-col divide-y divide-line`;

const ROW_BASE =
    "flex items-center gap-3 px-[14px] py-[13px] min-h-[54px] text-left w-full hover:bg-white/5 active:bg-white/[0.06] transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * 節（真鍮の眉ラベル＋札）。見出しの無い節（ログアウト・アカウントの削除）は札だけ。
 * 眉は節の見出し（h2）として読ませる——iOS も `.isHeader`
 */
export function SettingsGroup({ title, children, testId }: {
    title?: string;
    children: React.ReactNode;
    testId?: string;
}) {
    return (
        <section className="flex flex-col gap-2" data-testid={testId}>
            {title && <h2 className="m-0 px-1 eyebrow text-accent">{title}</h2>}
            <div className={SETTINGS_CARD}>{children}</div>
        </section>
    );
}

function RowText({ title, detail, color }: { title: string; detail?: React.ReactNode; color?: "danger" | "accent" }) {
    const titleColor = color === "danger" ? "text-danger" : color === "accent" ? "text-accent" : "text-white";
    return (
        <span className="flex-1 min-w-0 flex flex-col gap-[3px]">
            <span className={`text-[15px] leading-[20px] ${titleColor}`}>{title}</span>
            {detail && <span className="text-[12px] leading-[1.55] text-white/60">{detail}</span>}
        </span>
    );
}

function RowTail({ value, chevron }: { value?: string; chevron: boolean }) {
    return (
        <>
            {value && <span className="flex-shrink-0 text-[13px] text-white/60 tabular-nums whitespace-nowrap">{value}</span>}
            {chevron && <ChevronRightIcon aria-hidden="true" className={ROW_CHEVRON} style={{ strokeWidth: 2.5 }} />}
        </>
    );
}

/** 下の画面・ほかの画面へ行く行（›つき）。**先読みしない**（本人だけの画面・`linkPrefetch.test.ts`） */
export function SettingsRowLink({ href, title, detail, value, color, testId, external }: {
    href: string;
    title: string;
    detail?: React.ReactNode;
    value?: string;
    color?: "danger" | "accent";
    testId?: string;
    /** `mailto:` など、サイトの中の頁ではない行き先 */
    external?: boolean;
}) {
    const body = <><RowText title={title} detail={detail} color={color} /><RowTail value={value} chevron /></>;
    if (external) {
        return <a href={href} className={ROW_BASE} style={{ touchAction: "manipulation" }} data-testid={testId}>{body}</a>;
    }
    return (
        <Link href={href} prefetch={false} className={ROW_BASE} style={{ touchAction: "manipulation" }} data-testid={testId}>
            {body}
        </Link>
    );
}

/** その場で効く行・別の窓を開く行（ログアウト・アカウントの削除）。矢印は行き先があるときだけ */
export const SettingsRowButton = React.forwardRef<HTMLButtonElement, {
    title: string;
    detail?: React.ReactNode;
    onClick: () => void;
    color?: "danger" | "accent";
    chevron?: boolean;
    disabled?: boolean;
    busy?: boolean;
    testId?: string;
}>(function SettingsRowButton({ title, detail, onClick, color, chevron = false, disabled, busy, testId }, ref) {
    return (
        <button
            ref={ref}
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-busy={busy || undefined}
            className={ROW_BASE}
            style={{ touchAction: "manipulation" }}
            data-testid={testId}
        >
            <RowText title={title} detail={detail} color={color} />
            {busy && <span aria-hidden="true" className="flex-shrink-0 w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            <RowTail chevron={chevron} />
        </button>
    );
});

/** 札の中の注記（行ではない1文・iOS `SettingsView.note`） */
/**
 * 入切の行（板のトグル 51×31・入は accent-deep に白い玉・押せる高さは 44px）。
 * 2026-11-11: 「光と天気の知らせ」（`LightAlertSettings`）にあった形を、「検索エンジンに
 * プロフィールを表示しない」（`SearchHiddenSetting`・#526）と分け合うためにここへ移した（写しを作らない）。
 */
export function SettingsToggleRow({ label, detail, on, disabled, onToggle, testId }: {
    label: string;
    detail?: React.ReactNode;
    on: boolean;
    disabled?: boolean;
    onToggle: () => void;
    testId?: string;
}) {
    return (
        <div className="flex items-center gap-3 px-[14px] py-[13px] min-h-[54px]" data-testid={testId}>
            <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="text-[15px] leading-[20px] text-white">{label}</span>
                {detail && <span className="text-[12px] leading-[1.55] text-white/60">{detail}</span>}
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={label}
                disabled={disabled}
                onClick={onToggle}
                className="flex-shrink-0 flex items-center disabled:opacity-60"
                style={{ width: "51px", minHeight: "44px", touchAction: "manipulation" }}
            >
                <span
                    className={`relative block rounded-full transition-colors ${on ? "bg-accent-deep" : "bg-white/20"}`}
                    style={{ width: "51px", height: "31px" }}
                >
                    <span
                        className="absolute rounded-full bg-white transition-transform"
                        style={{
                            width: "27px", height: "27px", top: "2px", left: "2px",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
                            transform: on ? "translateX(20px)" : "translateX(0)",
                        }}
                    />
                </span>
            </button>
        </div>
    );
}

export function SettingsNote({ children, tone = "muted", role }: {
    children: React.ReactNode;
    tone?: "muted" | "danger";
    role?: "alert" | "status";
}) {
    return (
        <p role={role} className={`m-0 px-[14px] py-3 text-xs leading-relaxed ${tone === "danger" ? "text-danger" : "text-text-3"}`}>
            {children}
        </p>
    );
}

/**
 * 設定と、その下の画面の入れ物（iOS `SettingsPage`）。
 *
 * - **門はログインだけ見る**（`useMemberGate` を使わない。投稿権限の付かなかった人にも退会とパスワードの変更は要る）
 * - 判定中・送り返すまでの間は中身を描かない（未ログインに1描画ぶん見えていた）。読み込み中は灰の骨格（`LoadingState`）
 * - 戻る: いちばん上の設定はトップへ、下の画面は設定へ（iOS の「< 設定」）
 */
export function SettingsShell({ title, back, children, intro, testId = "settings-shell" }: {
    title: string;
    /** 戻り先。無ければトップ */
    back?: { href: string; label: string };
    /** 大見出しのすぐ下の説明（13・text-2・iOS のブロックした人など） */
    intro?: React.ReactNode;
    children?: React.ReactNode;
    testId?: string;
}) {
    const { isAuthenticated, loading } = useAuth();
    const { locale } = useLocale();
    const en = locale === "en";
    useLoginRedirect(!loading && !isAuthenticated);

    if (loading || !isAuthenticated) {
        return (
            <main className="min-h-screen bg-bg text-white">
                {/* **事前描画で焼かれるのはこの枝**（認証を確かめる前）。JS が走る前に見えるのはここなので見出しを持たせる */}
                <h1 className="sr-only">{title}</h1>
                <div className="max-w-sm mx-auto px-4 pt-24">
                    <LoadingState kind="rows" locale={en ? "en" : "ja"} />
                </div>
            </main>
        );
    }

    const backTo = back ?? { href: ROUTES.HOME, label: en ? "Back" : "戻る" };
    return (
        <main className="min-h-screen bg-bg text-white" data-testid={testId}>
            <div className="max-w-sm mx-auto px-4 pt-12 pb-16">
                <Link
                    href={backTo.href}
                    // ログイン後の画面なので先読みの免除側（`linkPrefetch.test.ts` の EXEMPT）
                    prefetch={false}
                    className="inline-flex items-center gap-1.5 min-h-[44px] text-xs text-white/60 hover:text-white transition-colors mb-4"
                    style={{ touchAction: "manipulation" }}
                >
                    <ArrowLeftIcon aria-hidden="true" className="w-3 h-3" />
                    {backTo.label}
                </Link>
                <div className="flex flex-col" style={{ gap: `${SETTINGS_LAYOUT.sectionGap}px` }}>
                    <div className="flex flex-col gap-1.5">
                        <h1 className={SETTINGS_TITLE_CLASS}>{title}</h1>
                        {intro && <p className="m-0 px-1 text-[13px] leading-[18px] text-text-2">{intro}</p>}
                    </div>
                    {children}
                </div>
            </div>
        </main>
    );
}
