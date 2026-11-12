"use client";

import React from "react";
import Link from "next/link";
import { ChevronRightIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { ROUTES } from "../../lib/routes";
import { weeklyThemeFor, hasJoinedTheme, themeParticipants, participantsLine, type WeeklyThemeEntry } from "../../lib/utils/weeklyTheme";
import { useAuth } from "../auth/context";
import { CheckCircleIcon } from "@heroicons/react/24/solid";
import { parseDailyQuiz, quizStorageKey, QUIZ_TIME_ZONE, type DailyQuiz } from "../../lib/utils/dailyQuiz";
import { todayIn } from "../../lib/utils/sunTimes";
import { tagKey } from "../../lib/utils/collections";
import type { HomeSeasonal } from "../../lib/data/spotTopics";
import type { Photo } from "@/lib/data/photos";
import Thumb from "./Thumb";
import { readSwipeStarted, readSwipeWants } from "../../lib/utils/spotSwipe";

/**
 * **ホームの上段のめくる札**（iOS の `HomeTopCardView`・`DailyThemeCard`・2026-10-31 束 1 H2）。
 *
 * 以前は「今日の一問」「撮影スポット」「今日のテーマ」が文字だけの帯（`HomeEntryRow`）で 3 本縦に積まれていた。
 * iOS は写真つきの横長の札を横にめくる 1 列にまとめている（写真が付くので目に留まり、写真の一覧が下がらない）。
 *
 *     札 1 枚: 背 116・左に写真 112（札の高さいっぱい・薄めない）・右に 眉（真鍮＋消える線）→ 明朝 18 の題 →
 *              12 text-2 の一行 → 出典 12 text-3 → ›。地 #0E0E0F・白8% の縁・角 16
 *     今日のテーマ: iOS の `DailyThemeCard` の形（眉の右に #タグ・題・一言・「参加する →」44・写真は右に 35% で薄く）
 *
 * 並び（iOS の `HomeTopCard.cards` のうち Web にあるもの）: 撮影スポットを払う（2026-11-11・いつも1枚目）→ 今週のお題 → 撮影スポット（Web だけ・残す）。
 * **2026-11-12（デザインの案 第10章「どこに何を置くか」）: 札は iOS と同じく最大3枚。**
 * 写真とカメラの教科書の札（2026-11-04 追加）は外した（≡ メニューに同じ「写真とカメラの教科書」がある）。
 * 今日の一問の札は「さがす」の面の先頭へ移した（`QuizCard`・iOS も探すの段へ移した）。
 * 旅行プラン・旅の一冊・1年前・行きたい場所の季節の札は Web に無い機能（台帳の束 6）。
 *
 * **2026-10-31 iOS #422（#417 ③）に合わせ直した**: 札の背はどれも 116、題・一行・出典は1行ずつ（出典は
 * 真ん中を省き、末尾のライセンス名を残す）。今日のテーマの「参加する →」は題の右の小さいボタン（見た目 36・当たり 44）、
 * 今週もう参加した週は押せない「✓ 参加済み」（`hasJoinedTheme`・前は今日のテーマで「今日もう参加した日」）。
 *
 * **電話の幅は横にめくる**（左右 16・次の札を 24 見せる・1 枚ずつ止まる）。**PC（1024 以上）は 3 列（1 段）に並べる**
 * （PC の幅の決まり W4: めくらずに並べる）。2026-11-12 に教科書と一問の札を外して 3 枚になった。背はいちばん高い札にそろえる。
 *
 * テーマと一問は**見ている端末の日付で決まる**ので、中身は載ったあとに入れる（静的 HTML に書き出した日の
 * テーマを焼かない・`ThemeEntry` の注記と同じ）。載るまでも札の形と行き先は出す（高さが変わらない）
 */
export default function HomeTopCards({ locale, photos, seasonal = null }: {
    locale: "ja" | "en";
    /** 今週のお題の札の写真と、みんなの参加を選ぶ一覧（ホームの写真） */
    photos: readonly Photo[];
    /** 撮影スポットの札の写真（いまの季節の 1 件目）。無ければ写真なしの札 */
    seasonal?: HomeSeasonal | null;
}) {
    const en = locale === "en";
    const { userId } = useAuth();
    const [theme, setTheme] = React.useState<WeeklyThemeEntry | null>(null);

    // 撮影スポットを払う入口の一行（2回目から「続きから」）。端末の控えなので載ったあとに読む
    const [swipe, setSwipe] = React.useState<{ started: boolean; wants: number }>({ started: false, wants: 0 });
    React.useEffect(() => {
        setSwipe({ started: readSwipeStarted(), wants: readSwipeWants().length });
    }, []);

    React.useEffect(() => {
        setTheme(weeklyThemeFor());
    }, []);

    // **みんなの参加**（今週お題のタグを付けて載せた公開の投稿・新しい順・iOS の `WeeklyTheme.participants`）。
    // 端末の日付で決まるので、お題と同じく載ったあとに数える
    const participants = React.useMemo(() => theme ? themeParticipants(theme, photos, tagKey) : [], [photos, theme]);

    // 背景: 今週の参加があればその 1 枚目、無ければお題のタグを持つ写真でいちばんいいねの多い 1 枚（iOS の `WeeklyThemeCard.backdrop`）
    const themePhoto = React.useMemo(() => {
        if (!theme) return null;
        if (participants.length > 0) return participants[0];
        const key = tagKey(theme.tag);
        const hits = photos.filter((p) => (p.tags ?? []).some((t) => typeof t === "string" && tagKey(t) === key));
        return hits.sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0))[0] ?? null;
    }, [photos, theme, participants]);

    // 今週もう参加したか（自分の写真のうち、今週＝日本の時刻の月曜からお題のタグで投稿した1枚）。描くのは載ったあと（その時の日付）
    const joined = React.useMemo(() => !!theme && !!userId
        && hasJoinedTheme(theme, photos.filter((p) => p.userId === userId), tagKey), [theme, userId, photos]);

    const spot = seasonal?.spots[0] ?? null;
    // 払う入口の写真は、撮影スポットの札と別の1枚（いまの季節の2件目）
    const swipeSpot = seasonal?.spots[1] ?? null;
    const credit = (c: { author: string; license?: string; text?: string } | null | undefined) => creditOf(c, en);

    return (
        <section aria-label={en ? "Today" : "今日の札"} className="mb-4 -mx-4 sm:mx-0" data-testid="home-top-cards">
            <ul className="relative flex lg:grid lg:grid-cols-3 gap-2 overflow-x-auto lg:overflow-visible no-scrollbar m-0 px-4 sm:px-0 items-stretch"
                // `relative`: 札の中の読み上げ用の字（`sr-only`・絶対配置）の基準をこの並びにする。無いと横に流れる並びの
                // 切り取りの外に出て、電話の幅で頁ごと 796px に広がった（2026-10-31 実測）
                style={{ listStyle: "none", scrollSnapType: "x mandatory", scrollPaddingLeft: "16px" }}>
                {/* 撮影スポットを払う（2026-11-11 owner の要望・iOS の札の1枚目と同じ）。**いつも1枚目**・新しい段は足さない。
                    未ログインでも払える。2回目からは「続きから」 */}
                <li className={CARD_LI} style={CARD_LI_STYLE}>
                    <TopCard
                        href={ROUTES.SWIPE}
                        testId="home-swipe-entry"
                        eyebrow={en ? "WHERE TO NEXT" : "写真を払う"}
                        spoken={en ? "Swipe photos" : "写真を払う"}
                        // 題・一行は札の幅で1行に収まる長さ（2026-11-11 Playwright・390 幅で「写真を払って、…」と切れた）
                        title={en ? "Find where to go" : "行きたい場所を探す"}
                        line={swipe.started
                            ? (userId
                                ? (en ? "Continue" : "続きから払う")
                                : (en ? `${swipe.wants} saved · Continue` : `行きたい ${swipe.wants} か所 · 続きから`))
                            : (userId
                                ? (en ? "Swipe right to save" : "右へ払うと行きたい")
                                : (en ? "No sign-in needed" : "ログインなしではじめる"))}
                        detail={swipeSpot ? credit(swipeSpot.credit) : undefined}
                        imageUrl={swipeSpot?.src}
                    />
                </li>
                <li className={CARD_LI} style={CARD_LI_STYLE}>
                    <ThemeCard theme={theme} photo={themePhoto} en={en} joined={joined} participants={participants} />
                </li>
                <li className={CARD_LI} style={CARD_LI_STYLE}>
                    <TopCard
                        href={ROUTES.SPOTS}
                        testId="home-spots-entry"
                        eyebrow={en ? "PHOTO SPOTS" : "撮影スポット"}
                        spoken={en ? "Photo spots" : "撮影スポット"}
                        title={en ? "Places worth shooting" : "撮りに行ける場所"}
                        line={en ? "Guides to photo spots" : "撮影スポットの案内"}
                        detail={spot ? credit(spot.credit) : undefined}
                        imageUrl={spot?.src}
                    />
                </li>
            </ul>
        </section>
    );
}

/**
 * 札の幅: 電話は「画面 − 左右 16 − 次の札を 24 見せる」＝ 100% − 40px（並びの左右の余白は `px-4`）。
 * 1 枚ずつ左端で止まる。PC は格子の 1 マス
 */
const CARD_LI = "shrink-0 w-[calc(100%-40px)] lg:shrink lg:w-auto flex";
const CARD_LI_STYLE: React.CSSProperties = { scrollSnapAlign: "start" };

/** 出典の1行。**真ん中を省く**——作者名（頭）を切り、ライセンス名（尾）は残す（iOS の `.truncationMode(.middle)`） */
type Credit = { head: string; tail: string };

function creditOf(c: { author: string; license?: string; text?: string } | null | undefined, en: boolean): Credit | undefined {
    return c ? { head: `${en ? "Photo: " : "写真: "}${c.text || c.author}`, tail: c.license ? ` / ${c.license}` : "" } : undefined;
}

/**
 * **今日の一問の札**（2026-11-12・デザインの案 第10章「どこに何を置くか」）。ホームの上の札から外し、「さがす」の面の先頭に置く
 * （iOS も今日の一問を探すの段へ移した。ホームの札は最大3枚）。形はホームの札と同じ（背 116・写真 112・真鍮の眉）。
 * 一問は**見ている端末の日付で決まる**ので、中身は載ったあとに入れる。取れない日は写真なしの札のまま（空き地は作らない）
 */
export function QuizCard({ locale, testId = "search-quiz-entry" }: { locale: "ja" | "en"; testId?: string }) {
    const en = locale === "en";
    const [quiz, setQuiz] = React.useState<{ quiz: DailyQuiz; answered: boolean } | null>(null);
    React.useEffect(() => {
        const ymd = todayIn(QUIZ_TIME_ZONE);
        if (!ymd) return;
        let alive = true;
        (async () => {
            try {
                const res = await fetch(`/app/data/quiz/${ymd}.json`);
                if (!res.ok) return;
                const parsed = parseDailyQuiz(await res.json(), ymd);
                if (!alive || !parsed) return;
                let answered = false;
                try { answered = !!window.localStorage.getItem(quizStorageKey(ymd)); } catch { /* 読めなければ未回答 */ }
                setQuiz({ quiz: parsed, answered });
            } catch { /* 取れない日は写真なしの札のまま（空き地は作らない） */ }
        })();
        return () => { alive = false; };
    }, []);
    return (
        <TopCard
            href={ROUTES.QUIZ}
            testId={testId}
            eyebrow={en ? "DAILY QUIZ" : "今日の一問"}
            spoken={en ? "Daily quiz" : "今日の一問"}
            title={en ? "Where is this?" : "この写真はどこ？"}
            line={quiz?.answered
                ? (en ? "Answered · A new photo tomorrow" : "答えました · 明日また新しい写真")
                : (en ? "Guess the spot from four choices" : "4つの中から撮影地を当てる")}
            detail={quiz ? creditOf({ author: quiz.quiz.photo.author, license: quiz.quiz.photo.license }, en) : undefined}
            imageUrl={quiz ? (quiz.quiz.photo.thumbUrl || quiz.quiz.photo.url) : undefined}
        />
    );
}

const CARD_FACE = "flex w-full h-[116px] rounded-2xl bg-surface ring-1 ring-inset ring-line overflow-hidden text-white hover:bg-surface-2 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent";

/**
 * 眉（真鍮・消える線）。英字の飾りは読み上げに出さず、日本語の名前を読ませる（iOS の `JPEyebrowLine(spoken:)`）。
 * **日本語の画面では日本語で出す**（2026-11-09 owner 承認・9人のレビュー: 最初の画面の英語の眉 11px が多かった。
 * 英語の画面だけ英字のまま）。字は同じ眉の形（SF 600・11・字間 0.14em）
 */
function Eyebrow({ text, spoken, trailing }: { text: string; spoken: string; trailing?: string }) {
    return (
        <span className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true" className="eyebrow eyebrow-line text-accent flex-1 min-w-0">{text}</span>
            <span className="sr-only">{spoken}</span>
            {trailing && <span className="flex-shrink-0 text-text-2 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>{trailing}</span>}
        </span>
    );
}

function TopCard({ href, testId, eyebrow, spoken, title, line, detail, imageUrl }: {
    href: string; testId: string; eyebrow: string; spoken: string; title: string; line: string; detail?: Credit; imageUrl?: string;
}) {
    return (
        <Link href={href} prefetch={false} data-testid={testId} className={CARD_FACE} style={{ touchAction: "manipulation" }}>
            {imageUrl && (
                <span className="relative flex-shrink-0 w-[112px] self-stretch bg-surface-2" aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
                </span>
            )}
            <span className="min-w-0 flex-1 flex items-center gap-2 pl-4 pr-3 py-3">
                <span className="min-w-0 flex-1 flex flex-col gap-1 self-start">
                    <Eyebrow text={eyebrow} spoken={spoken} />
                    <span className="font-serif font-bold truncate" style={{ fontSize: "18px", lineHeight: "24px" }}>{title}</span>
                    <span className="text-text-2 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>{line}</span>
                    {detail && (
                        <span className="flex min-w-0 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }} data-testid="top-card-credit">
                            <span className="truncate min-w-0">{detail.head}</span>
                            {detail.tail && <span className="flex-shrink-0 whitespace-nowrap">{detail.tail}</span>}
                        </span>
                    )}
                </span>
                <ChevronRightIcon aria-hidden="true" className="flex-shrink-0 text-text-2" style={{ width: 14, height: 14, strokeWidth: 2 }} />
            </span>
        </Link>
    );
}

/**
 * 今週のお題（iOS の `WeeklyThemeCard`・札 journey.photo-ios#537 案2・前は今日のテーマ・#422）。眉の右に #タグ、
 * 題の右に「参加する →」（見た目 36・当たり 44・白の塗りに墨・お題のタグを入れた投稿画面へ）、その下に一言（1行）。
 * 今週もう参加した週は押せない「✓ 参加済み」。
 * **今週の参加があれば、一言の行を「みんなの参加」の行に替える**（24 の写真を最大 4 枚＋「今週 N件の投稿」・
 * 押すとお題のタグで絞った「さがす」。当たりは上下に広げて 44）
 */
function ThemeCard({ theme, photo, en, joined, participants }: {
    theme: WeeklyThemeEntry | null; photo: Photo | null; en: boolean; joined: boolean; participants: readonly Photo[];
}) {
    const href = theme ? `${ROUTES.UPLOAD}?tag=${encodeURIComponent(theme.tag)}` : ROUTES.UPLOAD;
    const pill = "relative inline-flex items-center justify-center gap-1 rounded-full font-semibold whitespace-nowrap flex-shrink-0 px-[14px]";
    const pillStyle = { minHeight: "36px", fontSize: "13px", lineHeight: "18px" } as const;
    return (
        <div className={`${CARD_FACE} relative flex-col justify-start gap-1 px-4 py-3 hover:bg-surface`} data-testid="home-theme-card">
            {photo && (
                // **写真は脇役**（右に 160・35% で薄く・左へ消える）
                <span aria-hidden="true" className="absolute inset-y-0 right-0 w-[160px] pointer-events-none"
                      style={{ opacity: 0.35, maskImage: "linear-gradient(to right, transparent, black)", WebkitMaskImage: "linear-gradient(to right, transparent, black)" }}>
                    <Thumb photo={photo} alt="" sizes="160px" />
                </span>
            )}
            <span className="relative flex flex-col gap-1 min-w-0">
                <Eyebrow text={en ? "THIS WEEK" : "今週のお題"} spoken={en ? "This week's theme" : "今週のお題"} trailing={theme ? `#${theme.tag}` : undefined} />
                <span className="flex items-center gap-2 min-w-0">
                    <span className="flex-1 min-w-0 font-serif font-bold truncate" style={{ fontSize: "18px", lineHeight: "24px" }}>
                        {theme ? (en ? theme.title.en : theme.title.ja) : "\u00a0"}
                    </span>
                    {joined ? (
                        <span className={`${pill} bg-surface-2 text-white`} style={pillStyle} data-testid="home-theme-joined">
                            <CheckCircleIcon aria-hidden="true" style={{ width: 14, height: 14 }} />
                            {en ? "Joined" : "参加済み"}
                        </span>
                    ) : (
                        <Link href={href} prefetch={false} data-testid="home-theme-entry"
                              aria-label={theme ? (en ? `Join this week's theme #${theme.tag}` : `今週のお題 #${theme.tag} に参加する`) : (en ? "Join this week's theme" : "今週のお題に参加する")}
                              // 見た目 36・当たりは上下 4 ずつ広げて 44（`INLINE_BTN` と同じ形）
                              className={`${pill} bg-primary text-ink hover:brightness-110 transition before:absolute before:inset-x-0 before:-inset-y-[4px] before:content-[''] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent`}
                              style={{ ...pillStyle, touchAction: "manipulation" }}>
                            {en ? "Join" : "参加する"}
                            <ArrowRightIcon aria-hidden="true" style={{ width: 12, height: 12, strokeWidth: 2.4 }} />
                        </Link>
                    )}
                </span>
                {theme && participants.length > 0 ? (
                    <Link href={`${ROUTES.SEARCH}?tags=${encodeURIComponent(theme.tag)}`} prefetch={false}
                          data-testid="home-theme-participants"
                          // 見た目は 24 の行、当たりは**下だけ** 20 広げて 44。上は広げない——上の「参加する」の当たり
                          // （見た目 36 の下に 4）が行の間 4 を埋めて、ちょうどこの行の上端まで来ている（重ねない・札 #537 の確かめ役）
                          className="relative flex items-center gap-1 min-w-0 self-start text-text-2 before:absolute before:inset-x-0 before:top-0 before:-bottom-[20px] before:content-[''] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent rounded"
                          style={{ height: 24, touchAction: "manipulation" }}>
                        <span className="sr-only">{en ? "Everyone's posts, " : "みんなの参加、"}</span>
                        {participants.slice(0, 4).map((p) => (
                            <span key={p.id} aria-hidden="true" className="relative flex-shrink-0 overflow-hidden bg-surface-2" style={{ width: 24, height: 24, borderRadius: 6 }}>
                                <Thumb photo={p} alt="" sizes="24px" />
                            </span>
                        ))}
                        <span className="truncate pl-1" style={{ fontSize: "12px", lineHeight: "16px" }}>
                            {participantsLine(participants.length, en)}
                        </span>
                        <ChevronRightIcon aria-hidden="true" className="flex-shrink-0" style={{ width: 12, height: 12, strokeWidth: 2 }} />
                    </Link>
                ) : (
                    <span className="text-text-2 truncate" style={{ fontSize: "12px", lineHeight: "16px" }}>
                        {theme ? (en ? theme.prompt.en : theme.prompt.ja) : "\u00a0"}
                    </span>
                )}
            </span>
        </div>
    );
}
