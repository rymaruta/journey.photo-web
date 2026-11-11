"use client";

import React from "react";
import Link from "next/link";
import { ArrowUturnLeftIcon, ChevronRightIcon, HeartIcon, MapIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useAuth } from "../auth/context";
import { useLocale } from "../i18n/context";
import { useToast } from "../../lib/hooks/useToast";
import { useSavedSpots } from "../../lib/hooks/useSavedSpots";
import { loginWithNext, ROUTES } from "../../lib/routes";
import { userFetch } from "../../lib/utils/api";
import { spotSavedKey } from "../../lib/utils/savedSpotKey";
import {
    addSwipeSeen, addSwipeWant, buildSwipeDeck, handOffSwipeWants, markSwipeStarted, parseSwipeDeck,
    readSwipeSeen, readSwipeWants, removeSwipeSeen, removeSwipeWant, resetSwipeSeen, showsSwipePause,
    SWIPE_WANT_MAX, type SwipeCard,
} from "../../lib/utils/spotSwipe";
import { TopicCreditLine } from "../components/SpotTopicLists";
import { queueSpotWant, unqueueSpotWant, useFlushSpotWantsOnLeave } from "../../lib/utils/spotWants";
import { BTN_FILL, BTN_LINE } from "../components/buttonStyles";

/**
 * **撮影スポットを払う**（`/swipe`・2026-11-11 owner の要望の①・iOS の `SpotSwipeView`／`TripPickerView`）。
 *
 * 写真を1枚ずつ大きく出し、右へ払う＝行きたい・左へ払う＝見送る。下のボタン（見送る・ひとつ戻す・行きたい）、
 * キーボードの ← →、読み上げ（ボタンの名前と、結果を知らせる `role="status"`）でも同じことができる。
 *
 *  - **未ログインでも払える。** 「行きたい」は端末に撮影スポットの鍵だけ（最大 40・`lib/utils/spotSwipe.ts`）。
 *    結果（地図・旅行プラン）はログインしてから——挟む札と足元の「地図で見る」が `/login?next=/swipe&via=swipe` へ
 *  - **ログインして戻ったら**、端末の鍵を `POST /user/spots` で送って消し、「移しました」と地図への口を出す
 *  - ログイン中は払った瞬間に「行きたい場所」へ（同じ口）。ひとつ戻すと、この画面で足したものだけ外す
 *  - 5枚払って「行きたい」が1つ以上なら、山の中に札を1枚だけ挟む（窓で止めない・左へ払えば続く・次は10枚あと）
 *  - 写真の上には白しか置かない。写真の出典は撮影スポットの頁と同じ決まり（`TopicCreditLine`）で写真のすぐ下に
 */

type Decision = { card: SwipeCard; choice: "want" | "skip"; added: boolean };
type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; cards: SwipeCard[] };

/**
 * 札の高さ。縦 4:5 を上限に、**電話の1画面に札・名前と出典・ボタン・足元が収まる**高さまで縮める
 * （2026-11-11 Playwright・390×844 の実測: 4:5 のままだとボタンが下のタブの裏に隠れ、押す前に送る手間が増えた）
 */
const CARD_HEIGHT = "max(240px, min(calc((min(100vw, 576px) - 32px) * 1.25), calc(100dvh - 480px)))";
const THRESHOLD = 110;
const FLY_MS = 200;

export default function SwipeClient() {
    const { locale } = useLocale();
    const en = locale === "en";
    const { isAuthenticated, loading } = useAuth();
    const { showToast } = useToast();
    const saved = useSavedSpots(isAuthenticated, loading);

    const [load, setLoad] = React.useState<Load>({ state: "loading" });
    const [attempt, setAttempt] = React.useState(0);
    const [deck, setDeck] = React.useState<SwipeCard[] | null>(null);
    const [decisions, setDecisions] = React.useState<Decision[]>([]);
    const [continuedAt, setContinuedAt] = React.useState<number | null>(null);
    /** 行きたいの数（端末の鍵、またはサーバーの一覧＋この画面で足した分） */
    const [wishCount, setWishCount] = React.useState(0);
    const [dx, setDx] = React.useState(0);
    const [flying, setFlying] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);
    const [said, setSaid] = React.useState("");
    const [moved, setMoved] = React.useState<number | null>(null);
    const reduceMotion = usePrefersReducedMotion();
    useFlushSpotWantsOnLeave();

    // 札の山（ビルドで書き出した小さな JSON）
    React.useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch("/app/data/swipe.json");
                if (!res.ok) throw new Error(String(res.status));
                const cards = parseSwipeDeck(await res.json());
                if (alive) setLoad({ state: "ready", cards });
            } catch {
                if (alive) setLoad({ state: "failed" });
            }
        })();
        return () => { alive = false; };
    }, [attempt]);

    React.useEffect(() => { markSwipeStarted(); }, []);

    // ログインして戻った: 端末の鍵をサーバーへ移す（1回だけ）
    const handing = React.useRef(false);
    React.useEffect(() => {
        if (loading || !isAuthenticated || handing.current) return;
        if (readSwipeWants().length === 0) return;
        handing.current = true;
        (async () => {
            const result = await handOffSwipeWants(async (key) => {
                const res = await userFetch("/user/spots", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ slug: key }),
                });
                return res.ok;
            });
            if (result.moved > 0) {
                setMoved(result.moved);
                saved.retry();
            }
            if (result.left > 0) {
                showToast(en ? "Some places couldn't be moved yet. Open this page again later." : "まだ移せなかった場所があります。時間をおいて開き直してください。", "error");
            }
        })();
    }, [loading, isAuthenticated, saved, showToast, en]);

    // 山を作る（1回だけ）。ログイン中は「行きたい場所」の一覧が分かってから（入れた場所を出さない）
    React.useEffect(() => {
        if (deck !== null || load.state !== "ready" || loading) return;
        if (isAuthenticated && saved.pending) return;
        const wanted = new Set<string>(isAuthenticated ? saved.slugs : readSwipeWants());
        const built = buildSwipeDeck(load.cards, wanted, new Set(readSwipeSeen()));
        if (built.restarted) resetSwipeSeen();
        setDeck(built.deck);
        setWishCount(isAuthenticated ? saved.slugs.length : readSwipeWants().length);
    }, [deck, load, loading, isAuthenticated, saved.pending, saved.slugs]);

    const current = deck && deck[decisions.length] ? deck[decisions.length] : null;
    const upcoming = deck && deck[decisions.length + 1] ? deck[decisions.length + 1] : null;
    const wants = decisions.filter((d) => d.choice === "want").length;
    const paused = current !== null && showsSwipePause(decisions.length, wants, continuedAt);
    const mapHref = isAuthenticated ? ROUTES.SAVED_SPOTS_MAP : loginWithNext(ROUTES.SWIPE, "swipe");

    const commit = React.useCallback(async (choice: "want" | "skip") => {
        if (!current) return;
        let added = false;
        if (choice === "want") {
            const key = spotSavedKey(current.slug);
            if (isAuthenticated) {
                const already = saved.slugs.includes(key);
                if (!already) {
                    try {
                        const res = await userFetch("/user/spots", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ slug: key }),
                        });
                        added = res.ok;
                    } catch {
                        added = false;
                    }
                    if (!added) showToast(en ? "Couldn't save. Check your connection." : "行きたい場所に入れられませんでした。通信を確かめてください。", "error");
                }
            } else {
                added = !readSwipeWants().includes(key);
                addSwipeWant(current.slug);
            }
            if (added) setWishCount((n) => n + 1);
        }
        // みんなの「行きたい」に数える（②・端末のでたらめな ID と一緒にまとめて送る）。見送るは数えない
        if (choice === "want") queueSpotWant(current.slug);
        addSwipeSeen(current.slug);
        setDecisions((d) => [...d, { card: current, choice, added }]);
        setSaid(choice === "want"
            ? (en ? `Saved: ${current.name}` : `行きたいに入れました: ${current.name}`)
            : (en ? `Passed: ${current.name}` : `見送りました: ${current.name}`));
    }, [current, isAuthenticated, saved.slugs, showToast, en]);

    /** 払う・押す・キーの3つがここに来る（飛ばしてから決める） */
    const choose = React.useCallback((choice: "want" | "skip") => {
        if (flying || !current) return;
        if (paused) {
            // 挟んだ札はどちらへ払っても続ける
            const go = () => { setDx(0); setContinuedAt(decisions.length); };
            if (reduceMotion) { go(); return; }
            setFlying(true);
            setDx(choice === "want" ? 600 : -600);
            window.setTimeout(() => { go(); setFlying(false); }, FLY_MS);
            return;
        }
        if (choice === "want" && !isAuthenticated && !readSwipeWants().includes(spotSavedKey(current.slug))
            && readSwipeWants().length >= SWIPE_WANT_MAX) {
            setDx(0);
            showToast(en ? `You can pick up to ${SWIPE_WANT_MAX} places. Sign in to keep more.`
                : `選べるのは ${SWIPE_WANT_MAX} か所までです。ログインすると行きたい場所に移せます。`, "error");
            return;
        }
        if (reduceMotion) { setDx(0); void commit(choice); return; }
        setFlying(true);
        setDx(choice === "want" ? 600 : -600);
        window.setTimeout(() => {
            setDx(0);
            void commit(choice).finally(() => setFlying(false));
        }, FLY_MS);
    }, [flying, current, paused, decisions.length, reduceMotion, isAuthenticated, showToast, en, commit]);

    const undo = React.useCallback(async () => {
        if (flying) return;
        const last = decisions[decisions.length - 1];
        if (!last) return;
        setDecisions((d) => d.slice(0, -1));
        if (continuedAt !== null && decisions.length - 1 < continuedAt) setContinuedAt(null);
        removeSwipeSeen(last.card.slug);
        if (last.choice === "want") unqueueSpotWant(last.card.slug);
        if (last.choice === "want" && last.added) {
            const key = spotSavedKey(last.card.slug);
            if (isAuthenticated) {
                try {
                    await userFetch(`/user/spots/${encodeURIComponent(key)}`, { method: "DELETE" });
                } catch { /* 外せなくても札は戻す（行きたい場所の一覧から外せる） */ }
            } else {
                removeSwipeWant(key);
            }
            setWishCount((n) => Math.max(0, n - 1));
        }
        setSaid(en ? `Undid: ${last.card.name}` : `ひとつ戻しました: ${last.card.name}`);
    }, [flying, decisions, continuedAt, isAuthenticated, en]);

    // キーボード: → 行きたい・← 見送る（入力欄にいるときは使わない）
    React.useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
            if (e.key === "ArrowRight") { e.preventDefault(); choose("want"); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); choose("skip"); }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [choose]);

    // 指・マウスで払う
    const start = React.useRef<{ x: number; t: number } | null>(null);
    const onPointerDown = (e: React.PointerEvent) => {
        if (flying) return;
        start.current = { x: e.clientX, t: e.timeStamp };
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!start.current || flying) return;
        setDx(e.clientX - start.current.x);
    };
    const onPointerEnd = (e: React.PointerEvent) => {
        const s = start.current;
        start.current = null;
        setDragging(false);
        if (!s || flying) return;
        const distance = e.clientX - s.x;
        const speed = distance / Math.max(1, e.timeStamp - s.t);
        // 速さだけで決めない（押しただけの小さな揺れで飛ばさない）
        if (distance > THRESHOLD || (distance > 24 && speed > 0.8)) choose("want");
        else if (distance < -THRESHOLD || (distance < -24 && speed < -0.8)) choose("skip");
        else setDx(0);
    };

    const cardStyle: React.CSSProperties = {
        transform: `translateX(${dx}px) rotate(${dx / 24}deg)`,
        transition: dragging || reduceMotion ? "none" : `transform ${FLY_MS}ms ease-out`,
        touchAction: "pan-y",
    };
    const stamp = (dir: 1 | -1) => Math.max(0, Math.min(1, (dx * dir) / THRESHOLD));

    return (
        <section aria-label={en ? "Swipe photo spots" : "撮影スポットを払う"} className="mt-4" data-testid="swipe">
            {moved !== null && (
                <div className="mb-4 rounded-2xl bg-accent-soft px-4 py-3 flex items-center gap-3" role="status" data-testid="swipe-moved">
                    <p className="m-0 flex-1 text-white" style={{ fontSize: "14px", lineHeight: "20px" }}>
                        {en ? `Moved ${moved} place${moved === 1 ? "" : "s"} to your saved places.` : `払った ${moved} か所を、行きたい場所に移しました`}
                    </p>
                    <Link href={ROUTES.SAVED_SPOTS_MAP} prefetch={false} className="flex-shrink-0 inline-flex items-center gap-1 min-h-[44px] text-accent font-semibold" style={{ fontSize: "14px" }}>
                        {en ? "See on map" : "地図で見る"}
                        <ChevronRightIcon aria-hidden="true" style={{ width: 14, height: 14, strokeWidth: 2 }} />
                    </Link>
                </div>
            )}

            <p className="sr-only" role="status" aria-live="polite">{said}</p>

            {load.state === "failed" ? (
                <div className="rounded-2xl bg-surface py-12 px-6 flex flex-col items-center text-center gap-3">
                    <p role="alert" className="m-0 text-white/70" style={{ fontSize: "14px" }}>{en ? "Couldn't load photo spots." : "撮影スポットを読み込めませんでした。"}</p>
                    <button type="button" onClick={() => { setLoad({ state: "loading" }); setAttempt((n) => n + 1); }}
                            className={`${BTN_LINE}`} style={{ touchAction: "manipulation" }}>
                        {en ? "Try again" : "もう一度読み込む"}
                    </button>
                </div>
            ) : deck === null ? (
                <div className="w-full rounded-2xl bg-surface animate-pulse" style={{ height: CARD_HEIGHT }} aria-hidden="true" />
            ) : !current ? (
                <div className="rounded-2xl bg-surface py-12 px-6 flex flex-col items-center text-center gap-3" data-testid="swipe-done">
                    <p className="m-0 font-serif font-bold text-white" style={{ fontSize: "20px" }}>{en ? "That's all for now" : "ここまでで全部です"}</p>
                    <p className="m-0 text-text-2" style={{ fontSize: "14px" }}>{en ? "Come back later for more." : "また開くと、続きから払えます。"}</p>
                    {decisions.length > 0 && (
                        <button type="button" onClick={() => void undo()} className={`${BTN_LINE} inline-flex items-center gap-2`}>
                            <ArrowUturnLeftIcon aria-hidden="true" style={{ width: 16, height: 16 }} />
                            {en ? "Undo" : "ひとつ戻す"}
                        </button>
                    )}
                </div>
            ) : (
                <>
                    <div className="relative w-full mx-auto select-none" style={{ height: CARD_HEIGHT }}>
                        {/* 次の札を下に重ねる（めくった先があると分かる・先に読み込ませる） */}
                        {upcoming && !paused && (
                            <div aria-hidden="true" className="absolute inset-0 rounded-2xl overflow-hidden bg-surface" style={{ transform: "scale(0.95)", opacity: 0.5 }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={upcoming.src} alt="" className="absolute inset-0 w-full h-full object-cover" decoding="async" />
                            </div>
                        )}
                        {paused ? (
                            <div className="absolute inset-0 rounded-2xl bg-surface ring-1 ring-inset ring-line p-6 flex flex-col justify-center gap-3 cursor-grab"
                                 style={cardStyle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
                                 data-testid="swipe-pause">
                                <MapIcon aria-hidden="true" className="text-accent" style={{ width: 28, height: 28 }} />
                                <h2 className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "30px" }}>
                                    {en ? `See your ${wants} place${wants === 1 ? "" : "s"} on a map and in a trip` : `選んだ ${wants} か所を、地図と旅行プランで`}
                                </h2>
                                <p className="m-0 text-text-2" style={{ fontSize: "14px", lineHeight: "20px" }}>
                                    {isAuthenticated
                                        ? (en ? "They're in your saved places." : "行きたい場所に入っています。地図で並べて見られます。")
                                        : (en ? "Sign in to see them on your map." : "ログインすると、行きたい場所として地図に並びます。")}
                                </p>
                            </div>
                        ) : (
                            <div className="absolute inset-0 rounded-2xl overflow-hidden bg-surface cursor-grab"
                                 style={cardStyle} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
                                 role="img" aria-label={current.region ? `${current.name}、${current.region}` : current.name}
                                 data-testid="swipe-card" data-slug={current.slug}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img key={current.slug} src={current.src} alt="" draggable={false} className="absolute inset-0 w-full h-full object-cover pointer-events-none" decoding="async" />
                                {/* 払っている向きの札（写真の上なので白・黒の敷き） */}
                                <Stamp text={en ? "Want to go" : "行きたい"} side="left" opacity={stamp(1)} />
                                <Stamp text={en ? "Pass" : "見送る"} side="right" opacity={stamp(-1)} />
                            </div>
                        )}
                    </div>

                    {paused ? (
                        <div className="mt-4 flex flex-col gap-2">
                            {/* 写真の無い札の主ボタン＝真鍮の塗りに墨 */}
                            <Link href={mapHref} prefetch={false} data-testid="swipe-pause-action"
                                  className={`${BTN_FILL} bg-accent-fill text-ink inline-flex items-center justify-center`}>
                                {isAuthenticated ? (en ? "See on map" : "地図で見る") : (en ? "Sign in to see" : "ログインして見る")}
                            </Link>
                            <button type="button" onClick={() => choose("skip")} className={BTN_LINE} data-testid="swipe-continue">
                                {en ? "Keep swiping" : "続けて払う"}
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="mt-3 flex flex-col gap-1">
                                <h2 className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "30px" }} data-testid="swipe-name">
                                    <Link href={`/spots/${current.slug}`} prefetch={false} className="hover:underline underline-offset-4">{current.name}</Link>
                                </h2>
                                {current.region && <p className="m-0 text-text-2" style={{ fontSize: "13px" }}>{current.region}</p>}
                                {/* 出典は写真と必ず一緒に（CC BY・CC BY-SA の条件・撮影スポットの頁と同じ形） */}
                                {current.credit && <TopicCreditLine credit={current.credit} />}
                            </div>
                            <div className="mt-4 flex items-center gap-3">
                                <button type="button" onClick={() => choose("skip")} data-testid="swipe-pass"
                                        className={`${BTN_LINE} flex-1 inline-flex items-center justify-center gap-2 min-h-[52px]`}>
                                    <XMarkIcon aria-hidden="true" style={{ width: 18, height: 18, strokeWidth: 2 }} />
                                    {en ? "Pass" : "見送る"}
                                </button>
                                <button type="button" onClick={() => void undo()} disabled={decisions.length === 0 || flying}
                                        aria-label={en ? "Undo" : "ひとつ戻す"} data-testid="swipe-undo"
                                        className="flex-shrink-0 w-[52px] h-[52px] rounded-full ring-1 ring-inset ring-outline text-white inline-flex items-center justify-center disabled:opacity-40">
                                    <ArrowUturnLeftIcon aria-hidden="true" style={{ width: 18, height: 18, strokeWidth: 2 }} />
                                </button>
                                {/* 写真のある画面の主ボタン＝白の塗りに墨 */}
                                <button type="button" onClick={() => choose("want")} data-testid="swipe-want"
                                        className={`${BTN_FILL} flex-1 bg-primary text-ink inline-flex items-center justify-center gap-2 min-h-[52px]`}>
                                    <HeartIcon aria-hidden="true" style={{ width: 18, height: 18, strokeWidth: 2 }} />
                                    {en ? "Want to go" : "行きたい"}
                                </button>
                            </div>
                        </>
                    )}
                </>
            )}

            {/* 足元: 行きたいの数と、地図で見る（未ログインはログインへ） */}
            <div className="mt-5 pt-3 border-t border-line flex items-center gap-3">
                <span className="flex-1 text-text-2 tabular-nums" style={{ fontSize: "13px" }} data-testid="swipe-count">
                    {en ? `${wishCount} saved` : `行きたい ${wishCount} か所`}
                </span>
                <Link href={mapHref} prefetch={false} data-testid="swipe-map"
                      className="inline-flex items-center gap-1 min-h-[44px] text-accent font-semibold" style={{ fontSize: "14px" }}>
                    {en ? "See on map" : "地図で見る"}
                    <ChevronRightIcon aria-hidden="true" style={{ width: 14, height: 14, strokeWidth: 2 }} />
                </Link>
            </div>
        </section>
    );
}

function Stamp({ text, side, opacity }: { text: string; side: "left" | "right"; opacity: number }) {
    return (
        <span aria-hidden="true"
              className={`absolute top-4 ${side === "left" ? "left-4" : "right-4"} px-3 py-2 rounded-full text-white font-semibold`}
              style={{ opacity, fontSize: "14px", background: "rgba(0,0,0,.6)", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.9)" }}>
            {text}
        </span>
    );
}

function usePrefersReducedMotion(): boolean {
    const [reduce, setReduce] = React.useState(false);
    React.useEffect(() => {
        try {
            const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
            setReduce(mq.matches);
            const on = () => setReduce(mq.matches);
            mq.addEventListener?.("change", on);
            return () => mq.removeEventListener?.("change", on);
        } catch {
            return undefined;
        }
    }, []);
    return reduce;
}
