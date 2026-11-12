"use client";

// app/components/HomeJapanMap.tsx
//
// **ホームの「撮影スポットを地図から探す」**（2026-11-09・owner「任せる」→ 同日「案C（実形・地方→県・長押し/横寄りでなぞる・離して選択）で作り直し」）。
// 実形の日本地図で県を選ぶ入口。**ホームの写真のタブの面より上**（札・アプリの案内の下）に置く
// （owner の懸念: 写真の並びが長くて地図に辿り着けず離脱するのがいちばん悲しい）。
// 文字リンクの一覧（`HomeSpotEntry`・国内と海外）はホームの下に今のまま残す——SEO と、小さな県の保険。
//
// 🔴 **クライアント部品にしているのは `HomeSpotEntry` と同じ判断**。サーバー部品で 47 本の形を並べると
// RSC ペイロードに要素の木がもう1本入り、HTML が二重に太る。形のデータは部品の JS が持ち、
// サーバーで描いた HTML には 47 本の本物の `<a href>` がそのまま出る。渡すのは県のスラッグと件数だけ。
//
// 作り（仕様の正本: デザイナーの提案書「日本地図の県の選び方」v4）:
//   - **2 段**: 全国の画面は「地方」を当て、離すと地方が拡大して開く（県は選ばない）。拡大した地方の中で「県」を当てる。
//     北海道・沖縄は地方を拡大せず、直接県を選ぶ。地方の拡大は履歴を積まない（`japanMapView.ts`）
//   - **なぞって選ぶ**（`traceGesture.ts`）: 長押し 250ms（動き 8pt 以内）か、横寄り（8pt 超・水平から 45° 以下）でなぞり開始。
//     それ以外は縦スクロール・タップ（`touch-action: pan-y`）。なぞり中だけ自前の非 passive `touchmove` で preventDefault。
//     指の真上に名前の札（地方・県）。**離したときは、画面に見えていた県・地方を選ぶ**（再計算しない）。地図の外で離すと取り消し
//   - **タップの確定は `click`**（pointerup は使わない。慣性スクロール中に指で止めただけで地方が開くため）
//   - **当たり判定は自前**（`japanMapHit.ts`）: 形の中は必ずその県・形の外は輪郭から 16px 以内で最も近い県・触れている県を優先する粘り
//   - 各県は本物のリンク（行き先は県の頁・`ROUTES.SPOT_AREA`）。JS が効く前・新しいタブ・読み上げの「リンク」はそのまま県の頁へ行く。
//     JS が効いたあと、押す・Enter は頁を移動せず、その場に一覧（下の帯）を出す
//   - 帯は**常設の枠**（スマホで 164px・押し出さない・地図の高さは変えない）。選んでいないときは、押すと何が出るかの一言と一覧への近道
//     （2026-11-12 owner「なんも押してないのに県を選ぶというのわかりづらい」: 命令の見出し「県を選ぶ」をやめた）
//   - 県名: 全国は**地方名の札（押せるボタン・当たり 44px・`›` つき）**・拡大した地方は県の中に 14px（`prefectureRegionLabels.ts`・引き出し線は廃止）。
//     2026-11-12 owner「ガイドもないし」: 地方名がただの字で、押せると分からなかった。札にして、1回押せばその地方が開く。
//     札は指で押す近道なので読み上げ・Tab からは外す（同じ操作は上の地方チップが実ボタンで持つ。二重に読ませない）
//   - **全機能がタップ・キーボード・一覧で可能**（WCAG 2.5.1・2.5.7）: なぞりは上乗せ。地方チップ（実ボタン）・県の一覧チップ（地図の強調と連動）・
//     矢印キー（全国は地方、拡大した地方は県）・Enter・Esc。なぞり中の名前は読み上げず、確定したときだけ aria-live で読む
//   - 初見の手がかりの動き（輪が地方をなぞる見本・常設の一言「長押ししてなぞる」）は **2026-11-12 にやめた**。
//     本番を何も押さずに開いて記録すると、地図が見えて約 0.8 秒後から 2.8 秒、真鍮の輪・名前の札（「中部 9県」）・地方の強調・
//     固定欄の「触れている 中部」が、本物のなぞりと同じ見た目で出ていた（owner「なんも押してないのに県を選ぶ」）。
//     地方名を押せる札にしたので、見本で教えなくても押せば開く。なぞりは知っている人の近道として残す
//   - 安全策: なぞり判定・拡大の途中で例外が出ても、タップ（click）と一覧チップで県に必ず行ける
//
// URL・戻る（`#pref=kanagawa`）: 県を選んで帯を開くとき履歴を1件積む（戻る＝閉じる）・切り替えは差し替え・
//   県の頁へ進んで戻ると同じ県が開いたまま（その県の地方へ自動で拡大）。履歴の書き方は `withNextHistoryState`。
//   閉じるときは、**自分が積んだ履歴で、積んだときと `location.search` が同じときだけ** back() で消す。違うとき（タブを替えた後など）は差し替え
//
// 計測（`nav_click`・`area: home_entry`）: `dest: map_pref_select`（県を選んだ・選び直しも。閉じる操作は数えない）/
// `map_pref`（「すべて見る」・新しいタブなどで県の頁へ行った）。仕様（提案書 v4）に無い「帯が開いた」「スポットを押した」は数えない（2026-11-09 レビュー）。
// 地方の拡大・なぞり・濃淡は数えない（新しい計測は承認が要る）。県の名前・URL・スポットの slug は送らない。

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import type { HomeAreaRow } from "@/lib/data/homeSpotEntry";
import { PREFECTURES } from "@/lib/data/prefectures";
import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "@/lib/data/prefectureShapes";
import { REGION_LABELS, REGION_LABEL_PX } from "@/lib/data/prefectureRegionLabels";
import type { AreaTopSpot } from "@/lib/data/spotLink";
import { densityBin, densityCuts, nearestSlugs, neighborInDirection, prefFromHash, prefHash, shapeOf } from "@/lib/utils/japanMap";
import {
    ALL_VIEW, NOMINAL_W, OKINAWA_CENTER, REGION_ORDER, REGION_POS, easeOut, isDirectRegion, lerpView, membersOf, regionForSelection, regionOf, viewFor,
    type MapView, type RegionName,
} from "@/lib/utils/japanMapView";
import { hitAt, pickHit, regionHit, sameHit, type Hit, type HitContext } from "@/lib/utils/japanMapHit";
import { TraceGesture, type TraceWhy } from "@/lib/utils/traceGesture";
import { TIP_H, placeTip, type TipMode } from "@/lib/utils/japanMapTip";
import { withNextHistoryState } from "@/lib/utils/historyState";
import { clearMapReturn, readMapReturn, saveMapReturn } from "@/lib/utils/mapReturn";
import { ROUTES } from "@/lib/routes";
import SectionHead from "./SectionHead";
import TrackedLink from "./TrackedLink";
import { track } from "@/lib/utils/analytics";

const HEADING_ID = "home-japan-map-h";
const SHEET_ID = "home-japan-map-sheet";
const LIST_ID = "home-japan-map-list";
/** ページ内リンクの行き先（`HomeSpotEntry` の `<nav>`） */
export const SPOT_LIST_ID = "home-spot-entry-list";

const NAME = new Map(PREFECTURES.map((p) => [p.slug, p.name]));
const SHORT = (slug: string) => (slug === "hokkaido" ? "北海道" : (NAME.get(slug) ?? slug).replace(/[県府都]$/, ""));
const LABEL_BY_SLUG = new Map(REGION_LABELS.map((l) => [l[0], l]));

/** 重なったとき小さな県が上に来る並び（大きい県が先・DOM の後ろが上） */
const LINK_ORDER = [...PREFECTURE_SHAPES].sort((a, b) => b[2][2] * b[2][3] - a[2][2] * a[2][3]);

/** 県のリンクの当たりの箱（読み上げ・焦点の枠のための形）。沖縄は枠ぜんたい */
const hitBox = (sh: (typeof PREFECTURE_SHAPES)[number]) => (sh[0] === "okinawa" ? OKINAWA_FRAME : sh[2]);

const ARROWS: Record<string, readonly [number, number]> = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

/** 地方の色（全国の画面で、隣り合う地方が同じ色にならない 3 色の繰り返し） */
const TINT_OF = new Map<RegionName, "a" | "b" | "c">(REGION_ORDER.map((r, i) => [r, (["a", "b", "c"] as const)[i % 3]]));

/**
 * 全国の画面の地方名の札を置く位置（viewBox の単位）。字の位置（`REGION_POS`・提案書 v4）に、札どうしの当たり（44px）が
 * 重ならないよう、中国を 4 上・四国を 4 下へずらす（中国と四国は縦に 40 しか離れていない）
 */
const LABEL_NUDGE: Partial<Record<RegionName, readonly [number, number]>> = { 中国: [0, -4], 四国: [0, 4] };
function regionLabelAt(r: RegionName): readonly [number, number] {
    const [x, y] = r === "沖縄" ? OKINAWA_CENTER : REGION_POS[r];
    const d = LABEL_NUDGE[r] ?? [0, 0];
    return [x + d[0], y + d[1]];
}

/** 地方チップ */
const CHIPS = ["全国", ...REGION_ORDER] as const;
type ChipName = (typeof CHIPS)[number];

function slugOf(target: EventTarget | null): string | null {
    const a = target instanceof Element ? target.closest("a[data-s]") : null;
    return a ? a.getAttribute("data-s") : null;
}

/** 一覧を開いたときの履歴の印（戻る＝閉じる）と、積んだときの search。`history.state` に載せる */
const PUSHED_KEY = "jmPref";
const SEARCH_KEY = "jmSearch";

/** サーバーでは useLayoutEffect を呼ばない（React 19 でも何もしないが、意図をはっきりさせる） */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 例外を握りつぶさず、地図の操作だけを止めて（県への道は残して）コンソールへ出す */
function guard<T>(what: string, fn: () => T, fallback?: () => void): T | undefined {
    try { return fn(); } catch (e) {
        try { console.error(`[HomeJapanMap] ${what}`, e); } catch { /* 無視 */ }
        try { fallback?.(); } catch { /* 無視 */ }
        return undefined;
    }
}

export default function HomeJapanMap({ areas, tops = {} }: { areas: readonly HomeAreaRow[]; tops?: Readonly<Record<string, readonly AreaTopSpot[]>> }) {
    const uid = useId().replace(/:/g, "");
    const counts = useMemo(() => new Map(areas), [areas]);
    const among = useMemo(() => new Set(counts.keys()), [counts]);
    const cuts = useMemo(() => densityCuts([...counts.values()]), [counts]);

    // ---- 状態 ----
    /** 画面: null＝全国・地方名＝その地方を拡大 */
    const [stage, setStage] = useState<RegionName | null>(null);
    const [sel, setSel] = useState<string | null>(null);
    /** 触れている（なぞり・マウス・キーボード・一覧チップ）地方・県 */
    const [hov, setHovState] = useState<Hit | null>(null);
    const [tracing, setTracing] = useState(false);
    const [outside, setOutside] = useState(false);
    const [foc, setFoc] = useState<string | null>(null);
    /** 止まり先の県（roving tabindex）。JS が効くまで null＝47本とも普通のリンク */
    const [rove, setRove] = useState<string | null>(null);
    const [view, setViewState] = useState<MapView>(ALL_VIEW);
    const [wpx, setWpx] = useState(NOMINAL_W);
    const [dens, setDens] = useState(false);
    /** 地方の拡大・縮小の動き（260ms）の途中か。`data-zoom` に出す（動きが終わった印。スモークが固定時間ではなくこれを待つ・2026-11-09） */
    const [moving, setMoving] = useState(false);
    const [listOpen, setListOpen] = useState(false);
    const [announce, setAnnounce] = useState("");
    const [mounted, setMounted] = useState(false);
    /** マウスが地図の上にあって名前の札を出している */
    const [mouseOn, setMouseOn] = useState(false);

    // ---- 参照（イベントの中で最新の値を読む） ----
    const svgRef = useRef<SVGSVGElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<HTMLDivElement>(null);
    const listBtnRef = useRef<HTMLButtonElement>(null);
    const ringRef = useRef<HTMLDivElement>(null);
    const progRef = useRef<HTMLDivElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef(stage);
    stageRef.current = stage;
    const selRef = useRef(sel);
    selRef.current = sel;
    const hovRef = useRef<Hit | null>(null);
    const viewRef = useRef(view);
    viewRef.current = view;
    const wpxRef = useRef(wpx);
    wpxRef.current = wpx;
    const outsideRef = useRef(false);
    const tracingRef = useRef(false);
    const fingerRef = useRef<{ x: number; y: number } | null>(null);
    const tipModeRef = useRef<TipMode>("above");
    const tapRef = useRef<{ t: number } | null>(null);
    const lastCommitRef = useRef(0);
    const brokenRef = useRef(false);
    const animRef = useRef<number | null>(null);
    /** 押して開いた直後に、県が覆われないよう頁を寄せる対象（URL から戻したときは動かさない） */
    const revealPending = useRef<string | null>(null);
    /** 開いたのがキーボード・一覧チップなら、一覧（帯）へ焦点を移す（Esc で県へ戻す） */
    const focusSheetPending = useRef(false);

    const s = wpx / view.w; // 画面の px / 単位

    const setHov = useCallback((h: Hit | null) => { hovRef.current = h; setHovState(h); }, []);
    const setView = useCallback((v: MapView) => { viewRef.current = v; setViewState(v); }, []);
    const setStageBoth = useCallback((r: RegionName | null) => { stageRef.current = r; setStage(r); }, []);

    useEffect(() => { setMounted(true); setRove("hokkaido"); }, []);

    // 幅の変化を追う
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const read = () => { const w = el.getBoundingClientRect().width; if (w > 0) setWpx(w); };
        read();
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // ---- 拡大（260ms・ease-out cubic。動きを減らす設定・復元は即時） ----
    const camTo = useCallback((target: MapView, instant = false) => {
        if (animRef.current !== null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
        if (instant || prefersReducedMotion() || typeof requestAnimationFrame !== "function") { setView(target); setMoving(false); return; }
        const from = viewRef.current, t0 = performance.now();
        setMoving(true);
        const step = (now: number) => {
            const u = Math.min(1, (now - t0) / 260);
            setView(u >= 1 ? target : lerpView(from, target, easeOut(u)));
            animRef.current = u < 1 ? requestAnimationFrame(step) : null;
            if (u >= 1) setMoving(false);
        };
        animRef.current = requestAnimationFrame(step);
    }, [setView]);
    useEffect(() => () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current); }, []);

    /** 画面を替える。拡大が壊れても（例外）、即時に切り替えて県へは行ける */
    const gotoStage = useCallback((r: RegionName | null, instant = false) => {
        setStageBoth(r);
        guard("camTo", () => camTo(viewFor(r), instant), () => setView(viewFor(r)));
    }, [camTo, setStageBoth, setView]);

    // ---- URL（履歴） ----
    /** 履歴の state に印を付けて書く。Next の popstate が再読込に落ちない作法（`withNextHistoryState`） */
    const writeUrl = useCallback((slug: string | null, mode: "push" | "replace") => {
        try {
            const base = window.location.pathname + window.location.search;
            const url = slug ? base + prefHash(slug) : base;
            const st = window.history.state as Record<string, unknown> | null;
            const state = withNextHistoryState(slug ? {
                [PUSHED_KEY]: mode === "push" ? 1 : (st?.[PUSHED_KEY] ?? 0),
                [SEARCH_KEY]: mode === "push" ? window.location.search : (st?.[SEARCH_KEY] ?? window.location.search),
            } : {});
            if (!slug) { delete state[PUSHED_KEY]; delete state[SEARCH_KEY]; } // 閉じた状態の履歴に印は残さない（`withNextHistoryState` は印を持ち越す）
            if (mode === "push") window.history.pushState(state, "", url);
            else window.history.replaceState(state, "", url);
        } catch { /* 履歴が書けない環境でも一覧は開く */ }
    }, []);

    /**
     * 帯を閉じる。**自分が積んだ履歴で、積んだときと `location.search` が同じ**なら back() で消す（閉じたあとの「戻る」が空振りしない）。
     * 違うとき（開いたまま別のタブへ替えたあとなど）は back() せず、差し替えでハッシュだけ外す
     * （back() すると、積む前＝別のタブの履歴へ戻って、替えたタブが元に戻ってしまう）。`refocus` は県のリンクへ焦点を戻す
     */
    const closeSheet = useCallback((refocus = false) => {
        const cur = selRef.current;
        if (cur === null) return;
        setSel(null);
        revealPending.current = null;
        clearMapReturn();
        setAnnounce("観光スポットの一覧を閉じました。");
        if (refocus) svgRef.current?.querySelector<SVGAElement>(`a[data-s="${cur}"]`)?.focus({ preventScroll: true });
        try {
            const st = window.history.state as Record<string, unknown> | null;
            const mine = st?.[PUSHED_KEY] === 1 && (st?.[SEARCH_KEY] ?? "") === window.location.search && window.location.hash === prefHash(cur);
            if (mine) window.history.back();
            else if (window.location.hash) writeUrl(null, "replace");
        } catch { /* 同上 */ }
    }, [writeUrl]);

    /** 県を選ぶ（地図・一覧チップ・近くの県・リンクの Enter）。同じ県をもう一度選んでも変化なし。閉じるのは ✕・Esc・海のタップ */
    const selectPref = useCallback((slug: string, byKey = false) => {
        if (!among.has(slug)) return;
        const cur = selRef.current;
        if (cur === slug) { if (byKey) sheetRef.current?.focus({ preventScroll: true }); return; }
        track("nav_click", { area: "home_entry", dest: "map_pref_select" });
        setSel(slug);
        setRove(slug);
        setAnnounce(`${NAME.get(slug)}を選びました。観光スポット ${counts.get(slug) ?? 0}件。`);
        const target = regionForSelection(slug);
        if (target !== stageRef.current) gotoStage(target);
        revealPending.current = slug;
        focusSheetPending.current = byKey;
        writeUrl(slug, cur === null ? "push" : "replace");
    }, [among, counts, gotoStage, writeUrl]);

    /** 地方を拡大して開く（県は選ばない）。開いていた帯は閉じる */
    const goRegion = useCallback((r: RegionName, byKey = false) => {
        // キーボードの Enter（byKey）なら、県のリンクの Enter と同じく焦点を帯へ移す
        if (isDirectRegion(r)) { selectPref(r === "北海道" ? "hokkaido" : "okinawa", byKey); return; }
        if (selRef.current) closeSheet(false);
        gotoStage(r);
        setAnnounce(`${r}を拡大。${membersOf(r).length}県。`);
    }, [closeSheet, gotoStage, selectPref]);

    /** 全国へ戻る */
    const goAll = useCallback(() => {
        if (selRef.current) closeSheet(false);
        gotoStage(null);
        setAnnounce("全国の地図に戻りました。");
    }, [closeSheet, gotoStage]);

    // URL（`#pref=…`）から選択県を戻す: 最初の描画のあと・戻る/進む・ハッシュの変更。一覧の頁から戻ったときもここ
    useEffect(() => {
        let first = true;
        const sync = () => {
            const p = prefFromHash(window.location.hash, among);
            setSel(p);
            if (p) {
                setRove(p);
                const target = regionForSelection(p);
                if (target !== stageRef.current) gotoStage(target, true); // 戻る・共有リンクは動きなしで開く
            }
            first = false;
        };
        sync();
        void first;
        // iOS Safari の戻る（bfcache）は頁ごと元の状態で戻る（`pageshow` の persisted）。ハッシュと食い違っていたら合わせる
        const onShow = (e: PageTransitionEvent) => { if (e.persisted) sync(); };
        window.addEventListener("popstate", sync);
        window.addEventListener("hashchange", sync);
        window.addEventListener("pageshow", onShow);
        return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); window.removeEventListener("pageshow", onShow); };
    }, [among, gotoStage]);

    /**
     * **地図から県の頁へ進んで戻ったとき、地図の位置へ帰る**（2026-11-09 owner「地図で県に行って戻ったら、また地図に戻る」）。
     * 開いていた県は `#pref=…` が戻してくれる（上）。スクロール位置は:
     *   - ふつうはブラウザの復元に任せられる（実測 chromium・開発サーバー: 戻った 100ms 後は y=0・600ms 後に y=398 へ）。
     *     ただしこの 0 → 398 の間は頁の先頭が一瞬見える・読み込みが遅い回線・WebKit では外れうる（WebKit は手元に無く未確認）
     *   - なので進む直前の位置を `sessionStorage` に覚え（`mapReturn.ts`）、戻った直後と 0.4・1.2 秒後に、位置がずれていれば寄せる。
     *     ユーザーが触れたら（ホイール・タッチ・キー）それ以降は動かさない
     *   - 覚えが無いまま `#pref=` で開いた（共有リンク・別タブ）ときは、頁の先頭にいる場合だけ地図の頭へ寄せる
     */
    useEffect(() => {
        const pref = prefFromHash(window.location.hash, among);
        if (!pref) return;
        const rec = readMapReturn();
        const mine = rec !== null && rec.pref === pref ? rec : null;
        let touched = false;
        const mark = () => { touched = true; };
        const evs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
        evs.forEach((ev) => window.addEventListener(ev, mark, { passive: true, once: true }));
        const place = () => {
            if (touched) return;
            if (mine) {
                if (Math.abs(window.scrollY - mine.y) > 24) window.scrollTo({ top: mine.y, behavior: "auto" });
            } else if (window.scrollY < 1) {
                const sec = wrapRef.current?.closest("section");
                const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 56;
                if (sec) window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - header - 8, behavior: "auto" });
            }
        };
        const raf = requestAnimationFrame(place);
        const t1 = window.setTimeout(place, 400), t2 = window.setTimeout(place, 1200);
        return () => { evs.forEach((ev) => window.removeEventListener(ev, mark)); cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
        // 最初の描画のときだけ（戻った・開いた直後）。以後の押下では動かさない
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** 県の頁・スポットの頁へ進む直前に、位置と県を覚える（戻ったときの寄せ先） */
    const rememberMap = useCallback(() => {
        const cur = selRef.current;
        if (cur) saveMapReturn(cur, window.scrollY);
    }, []);

    // 押して開いた直後: キーボード・一覧チップなら帯へ焦点・スマホなら、貼り付いた帯に県が隠れないよう頁を寄せる
    useEffect(() => {
        const slug = revealPending.current;
        if (!sel || sel !== slug) return;
        revealPending.current = null;
        if (focusSheetPending.current) { focusSheetPending.current = false; sheetRef.current?.focus({ preventScroll: true }); }
        const sheet = sheetRef.current, svg = svgRef.current, sh = shapeOf(sel);
        if (!sheet || !svg || !sh || typeof window.matchMedia !== "function") return;
        if (!window.matchMedia("(max-width: 767.98px)").matches) return; // 広い画面は札が右にあり、地図を覆わない
        const r = svg.getBoundingClientRect();
        // 県の中心＋外接箱の高さの半分（上限 40px）の位置を、帯の上に出す（県の下側が帯に潜らないように）。
        // 拡大中の地図は、地方の画面に向けて動いている途中なので、行き先の viewBox で数える
        const v = viewFor(regionForSelection(sel));
        const k = r.height / v.h;
        const cy = r.top + (sh[3][1] - v.y) * k + Math.min((sh[2][3] * k) / 2, 40);
        const root = getComputedStyle(document.documentElement);
        const bar = parseFloat(root.getPropertyValue("--bottom-bar-h")) || 84;
        const mini = parseFloat(root.getPropertyValue("--mini-player-h")) || 0; // 再生バーが出ている間は、そのぶん帯も上がる
        const header = parseFloat(root.getPropertyValue("--header-h")) || 56;
        const covered = sheet.getBoundingClientRect().height + bar + mini + 8;
        const lo = header + 24, hi = window.innerHeight - covered - 40;
        if (hi <= lo) return;
        const delta = cy > hi ? cy - hi : cy < lo ? cy - lo : 0;
        if (delta !== 0) window.scrollBy({ top: delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }, [sel]);

    // ---- 札・輪の位置（指の位置は画面の px・`position: fixed`） ----
    const safeRect = useCallback(() => {
        const root = getComputedStyle(document.documentElement);
        const header = parseFloat(root.getPropertyValue("--header-h")) || 56;
        const bar = parseFloat(root.getPropertyValue("--bottom-bar-h")) || 0;
        return { left: 0, right: window.innerWidth, top: header + 8, bottom: window.innerHeight - bar };
    }, []);

    const layoutFinger = useCallback(() => {
        const f = fingerRef.current, ring = ringRef.current, tip = tipRef.current;
        if (!f) return;
        if (ring) { ring.style.left = `${f.x}px`; ring.style.top = `${f.y}px`; }
        if (tip && !tip.hidden) {
            const p = placeTip({ fx: f.x, fy: f.y, tw: tip.offsetWidth || 112, th: TIP_H, safe: safeRect(), prev: tipModeRef.current });
            tipModeRef.current = p.mode;
            tip.style.left = `${p.x}px`;
            tip.style.top = `${p.y}px`;
            tip.style.visibility = p.mode === "fixed" ? "hidden" : "visible"; // 入らないときは地図の上の固定欄の名前だけ
        }
    }, [safeRect]);
    // 札の中身（名前）が変わったら、幅が変わるので置き直す
    useIsoLayoutEffect(() => { layoutFinger(); });

    // ---- 当たり ----
    const ctxFor = useCallback((): HitContext => {
        const v = viewRef.current;
        return { region: stageRef.current, s: wpxRef.current / v.w, among };
    }, [among]);

    /** 画面の座標 → 地図の座標（地図の外は inside=false） */
    const toMap = useCallback((cx: number, cy: number) => {
        const r = svgRef.current?.getBoundingClientRect();
        const v = viewRef.current;
        if (!r || r.width === 0) return { x: 0, y: 0, inside: false };
        return { x: v.x + ((cx - r.left) / r.width) * v.w, y: v.y + ((cy - r.top) / r.height) * v.h, inside: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom };
    }, []);

    // ---- なぞり ----
    const setProg = (x: number | null, y = 0) => {
        const p = progRef.current;
        if (!p) return;
        if (x === null) { p.hidden = true; p.classList.remove("go"); return; }
        p.hidden = false;
        p.style.left = `${x}px`; p.style.top = `${y}px`;
        p.classList.remove("go");
        void p.getBoundingClientRect(); // アニメを頭から（reflow）
        if (!prefersReducedMotion()) p.classList.add("go");
    };

    const updateTrace = useCallback((x: number, y: number) => {
        fingerRef.current = { x, y };
        const m = toMap(x, y);
        if (!m.inside) {
            if (!outsideRef.current) { outsideRef.current = true; setOutside(true); setHov(null); }
        } else {
            if (outsideRef.current) { outsideRef.current = false; setOutside(false); }
            const h = pickHit(m.x, m.y, ctxFor(), hovRef.current);
            if (!sameHit(h, hovRef.current)) setHov(h);
        }
        layoutFinger();
    }, [ctxFor, layoutFinger, setHov, toMap]);

    const endTrace = useCallback(() => {
        tracingRef.current = false;
        outsideRef.current = false;
        setTracing(false);
        setOutside(false);
        setHov(null);
        fingerRef.current = null;
        setProg(null);
    }, [setHov]);

    /** 離した・タップした: 画面に見えていたもの（`h`）を選ぶ。無ければ何もしない（タップで帯が開いていれば閉じる） */
    const commit = useCallback((h: Hit | null, how: "trace" | "tap") => {
        lastCommitRef.current = Date.now();
        if (!h) { if (how === "tap" && selRef.current) closeSheet(false); return; }
        if (h.k === "region") goRegion(h.region);
        else selectPref(h.slug);
    }, [closeSheet, goRegion, selectPref]);

    /** なぞりの機械は最初の 1 回だけ作る。中から読む関数は毎回の描画の最新（`latest`）を呼ぶ */
    const latest = useRef({ updateTrace, endTrace, commit, ctxFor, toMap, layoutFinger });
    latest.current = { updateTrace, endTrace, commit, ctxFor, toMap, layoutFinger };
    const gestureRef = useRef<TraceGesture | null>(null);
    if (gestureRef.current === null) {
        gestureRef.current = new TraceGesture({
            pending: (x, y) => setProg(x, y),
            pendingEnd: () => setProg(null),
            begin: (x, y, why: TraceWhy, id) => {
                // 長押しのタイマーから呼ばれるので、ここで例外が出ても握る（なぞりだけ止めて、タップ・一覧チップは生かす）
                guardedRef.current("begin", () => {
                const L = latest.current;
                tracingRef.current = true;
                setTracing(true);
                try { wrapRef.current?.setPointerCapture(id); } catch { /* 取れなくても、地図の外は座標で判定する */ }
                if (why === "dwell") { try { navigator.vibrate?.(10); } catch { /* 触覚: iOS の Web は不可 */ } } // 長押し成立の合図（対応する端末だけ）
                const m = L.toMap(x, y);
                outsideRef.current = !m.inside;
                setOutside(!m.inside);
                setHov(m.inside ? pickHit(m.x, m.y, L.ctxFor(), null) : null);
                fingerRef.current = { x, y };
                L.layoutFinger();
            
                });
            },
            move: (x, y) => { guardedRef.current("move", () => latest.current.updateTrace(x, y)); },
            release: (x, y) => {
                const L = latest.current;
                const out = outsideRef.current || !L.toMap(x, y).inside;
                const h = hovRef.current;
                L.endTrace();
                if (out) return; // 地図の外で離す: 取り消し（選択は変えない）
                guardedRef.current("release", () => L.commit(h, "trace"));
            },
            abort: () => { latest.current.endTrace(); },
            tapCandidate: () => { tapRef.current = { t: Date.now() }; },
        });
    }
    /** なぞり・拡大の途中の例外: コンソールへ出し、なぞりの状態を戻す。タップ・一覧チップへは影響しない（fallback） */
    const guardedRef = useRef<(what: string, fn: () => void) => void>(() => {});
    guardedRef.current = (what, fn) => {
        guard(what, fn, () => { brokenRef.current = true; gestureRef.current?.reset(); latest.current.endTrace(); });
    };

    const pointerIn = (e: React.PointerEvent) => ({ id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, button: e.button, primary: e.isPrimary });

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        tapRef.current = null;
        if (e.pointerType === "mouse" && (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)) return; // 修飾キーつきは click で新しいタブへ
        guardedRef.current("down", () => gestureRef.current!.down(pointerIn(e)));
    };
    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const g = gestureRef.current!;
        if (e.pointerType === "mouse" && g.mode !== "tracing") {
            // マウスは押さなくても名前が出る（輪は出さない）
            guardedRef.current("hover", () => {
                const m = toMap(e.clientX, e.clientY);
                fingerRef.current = { x: e.clientX, y: e.clientY };
                const h = m.inside ? pickHit(m.x, m.y, ctxFor(), hovRef.current) : null;
                if (!sameHit(h, hovRef.current)) setHov(h);
                setMouseOn(h !== null);
                layoutFinger();
            });
            return;
        }
        guardedRef.current("move", () => g.move(pointerIn(e)));
    };
    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => { guardedRef.current("up", () => gestureRef.current!.up(pointerIn(e), false)); };
    const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => { guardedRef.current("cancel", () => gestureRef.current!.up(pointerIn(e), true)); };
    const onPointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "mouse" && gestureRef.current!.mode !== "tracing") { setHov(null); setMouseOn(false); fingerRef.current = null; }
    };

    // なぞりモード中だけ、自前の非 passive touchmove で preventDefault（React の onTouchMove は passive で止められない）
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const onTouchMove = (e: TouchEvent) => { if (tracingRef.current && e.cancelable) e.preventDefault(); };
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        return () => el.removeEventListener("touchmove", onTouchMove);
    }, []);

    /** 画面の切り替え・アンマウントで、なぞりの途中状態を残さない */
    useEffect(() => { const g = gestureRef.current; return () => { g?.reset(); }; }, []);

    // ---- クリック ----
    const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const modifier = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
        const slug = slugOf(e.target);
        if (slug) {
            // キーボード（Enter）・読み上げの操作: 修飾キーつきは本物のリンクとして県の頁へ（これだけ「移動」として数える）
            if (modifier || e.button !== 0) { track("nav_click", { area: "home_entry", dest: "map_pref" }); return; }
            e.preventDefault();
            selectPref(slug, e.detail === 0);
            return;
        }
        const m = toMap(e.clientX, e.clientY);
        if (modifier && m.inside) {
            // 修飾キーつきのクリック（新しいタブ）: 県の上なら、その県の頁を新しいタブで開く
            const h = guard("tap-open", () => hitAt(m.x, m.y, { ...ctxFor(), region: null }).best) ?? null;
            const target = h?.k === "pref" ? h.slug : null;
            if (target) { track("nav_click", { area: "home_entry", dest: "map_pref" }); window.open(ROUTES.SPOT_AREA(target), "_blank", "noopener"); }
            return;
        }
        // タップ（指を 8pt 以内で離したあとの click）。なぞって離したあとの click・マウスの押し上げのあとの click は使わない
        const cand = tapRef.current;
        tapRef.current = null;
        // 例外で壊れたあと・pointer イベントが無い環境では、click をそのままタップとして受ける（県へ必ず行ける）
        const noPointer = typeof window.PointerEvent === "undefined";
        const accepted = (cand !== null && Date.now() - cand.t <= 500) || ((brokenRef.current || noPointer) && Date.now() - lastCommitRef.current > 400);
        if (!accepted) return;
        if (!m.inside) { commit(null, "tap"); return; }
        try {
            commit(hitAt(m.x, m.y, ctxFor()).best, "tap");
        } catch (err) {
            // 当たりの計算が壊れても、一覧チップで県へ行けるように開く
            try { console.error("[HomeJapanMap] tap", err); } catch { /* 無視 */ }
            brokenRef.current = true;
            setListOpen(true);
            setAnnounce("地図を使えませんでした。県の一覧から選べます。");
        }
    };

    // ---- キーボード ----
    const [kb, setKb] = useState<RegionName | null>(null);
    const kbHit = (r: RegionName): Hit => regionHit(r);
    const regionCenter = (r: RegionName): readonly [number, number] => (r === "沖縄" ? OKINAWA_CENTER : REGION_POS[r]);
    const nextRegionIn = (from: RegionName, dx: number, dy: number): RegionName | null => {
        const c0 = regionCenter(from);
        let best: RegionName | null = null, bs = Infinity;
        for (const r of REGION_ORDER) {
            if (r === from) continue;
            const c = regionCenter(r);
            const vx = c[0] - c0[0], vy = c[1] - c0[1], d = Math.hypot(vx, vy);
            if (!d) continue;
            const cos = (vx * dx + vy * dy) / d;
            if (cos < 0.5) continue;
            if (d / cos < bs) { bs = d / cos; best = r; }
        }
        return best;
    };

    const focusLink = (slug: string) => svgRef.current?.querySelector<SVGAElement>(`a[data-s="${slug}"]`)?.focus();
    const members = useMemo(() => (stage ? membersOf(stage).filter((x) => among.has(x)) : []), [stage, among]);
    const tabStop = stage && members.length ? (rove && members.includes(rove) ? rove : members[0]) : null;

    const onWrapKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const dir = ARROWS[e.key];
        const onLink = slugOf(e.target);
        if (stageRef.current === null) {
            // 全国: 地方どうしを向きで移る（枠が焦点を持つ）。Enter・Space で開く
            if (onLink) return;
            if (dir) {
                e.preventDefault();
                const cur = kb ?? "関東";
                const nxt = kb ? nextRegionIn(cur, dir[0], dir[1]) ?? cur : "関東";
                setKb(nxt);
                setHov(kbHit(nxt));
                const n = isDirectRegion(nxt) ? `${nxt}。Enter で選びます。` : `${nxt}、${membersOf(nxt).length}県。Enter で拡大します。`;
                setAnnounce(n);
            } else if ((e.key === "Enter" || e.key === " ") && kb) {
                e.preventDefault();
                setKb(null); setHov(null);
                goRegion(kb, true);
            }
            return;
        }
        // 拡大した地方: 県のリンクが焦点を持つ。矢印で隣の県へ（開かない）。枠が焦点を持っているときは最初の矢印でリンクへ
        if (dir) {
            e.preventDefault();
            if (!onLink) { if (tabStop) focusLink(tabStop); return; }
            const to = neighborInDirection(onLink, dir[0], dir[1], new Set(members));
            if (to) focusLink(to);
        }
    };
    useEffect(() => { if (stage !== null) { setKb(null); } }, [stage]);

    const onWrapBlur = (e: React.FocusEvent<HTMLDivElement>) => {
        if (slugOf(e.target)) { setFoc(null); return; }
        if (kb && !wrapRef.current?.contains(e.relatedTarget as Node | null)) { setKb(null); if (hovRef.current) setHov(null); }
    };
    const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
        const slug = slugOf(e.target);
        if (!slug) return;
        setRove(slug);
        let visible = true;
        try { visible = (e.target as Element).matches(":focus-visible"); } catch { /* 古いブラウザは輪を出す */ }
        if (!visible) return; // マウスで押したときの焦点には輪を出さない（押した結果は `onClick`）
        setFoc(slug);
    };

    // 区切り: Esc は 帯を閉じる → 地方を閉じて全国へ
    const onSectionKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key !== "Escape") return;
        if (selRef.current) { e.preventDefault(); closeSheet(true); }
        else if (stageRef.current !== null) { e.preventDefault(); goAll(); wrapRef.current?.focus({ preventScroll: true }); }
    };

    // ---- 描画に使う値 ----
    /** 県の形を描く順（触れた・選んだ県は最後）と、その class */
    const drawOrder = PREFECTURE_SHAPES.map((sh) => {
        const slug = sh[0];
        const n = counts.get(slug);
        const cls = ["jm-sh", `jm-t${TINT_OF.get(regionOf(slug))}`];
        if (dens && n !== undefined) cls.push(`jm-b${densityBin(n, cuts)}`);
        if (stage !== null && !membersOf(stage).includes(slug)) cls.push("jm-dim");
        let hi = 0;
        if (hov && hov.k !== "region" && hov.slug === slug) { cls.push("jm-hov"); hi = 2; }
        else if (hov && hov.k === "region" && stage === null && regionOf(slug) === hov.region) { cls.push("jm-hovr"); hi = 1; }
        if (sel === slug) { cls.push("jm-sel"); hi = Math.max(hi, 1); }
        return { sh, cls: cls.join(" "), hi };
    }).sort((x, y) => x.hi - y.hi);
    const [fx, fy, fw, fh] = OKINAWA_FRAME;
    const selName = sel ? NAME.get(sel) : null;
    const selNear = sel ? nearestSlugs(sel, 3, among) : [];
    const selTops = (sel && tops[sel]) || [];
    const selCount = sel ? (counts.get(sel) ?? 0) : 0;
    const hovSlug = hov && hov.k !== "region" ? hov.slug : null;
    const hovRegion = hov && hov.k === "region" ? hov.region : null;
    const chipOn: ChipName = stage ?? (sel ? regionOf(sel) : "全国");
    const legend = [
        `〜${cuts[0]}件`, `${cuts[0] + 1}〜${cuts[1]}件`, `${cuts[1] + 1}〜${cuts[2]}件`, `${cuts[2] + 1}件〜`,
    ];
    const LEGEND_FILL = ["#1e1a12", "#3b301d", "#6b5937", "#a8864f"];

    /** 札の文字（名前・小さい字）。なぞり中・マウス・キーボード */
    const tip = (() => {
        if (outside) return { n: "離すと取り消し", sub: "地図の中に戻すと続けられます", cancel: true };
        if (!hov) return null;
        if (hov.k === "region") return { n: hov.region, sub: `${membersOf(hov.region).length}県`, cancel: false };
        const full = NAME.get(hov.slug) ?? hov.slug;
        if (hov.k === "switch") return { n: full, sub: `${regionOf(hov.slug)}へ移る`, cancel: false };
        const r = regionOf(hov.slug);
        const pre = stage !== null && !isDirectRegion(r) ? `${r} · ` : "";
        return { n: full, sub: `${pre}${counts.get(hov.slug) ?? 0}件`, cancel: false };
    })();

    /** 地図の上の固定欄（36px）の文 */
    const bar = (() => {
        if (outside) return <span>触れている　<span className="text-text-3">（地図の外です）</span></span>;
        if (hov?.k === "region") return <span>触れている　<b>{hov.region}</b></span>;
        if (hov) return <span>触れている　<b>{stage !== null ? `${regionOf(hov.slug)}　›　` : ""}{NAME.get(hov.slug)}</b></span>;
        if (tracing) return <span>触れている　<span className="text-text-3">（どの県にも当たっていません）</span></span>;
        if (stage !== null) return <span><b>{stage}</b> を表示中</span>;
        return <span>全国　地方を押すと開きます</span>;
    })();

    const tabIdx = (slug: string): number | undefined => (rove === null ? undefined : tabStop === slug ? 0 : -1);

    return (
        <section
            aria-labelledby={HEADING_ID}
            className="pt-2 pb-6 text-white"
            data-testid="home-japan-map"
            onKeyDown={onSectionKeyDown}
        >
            <SectionHead id={HEADING_ID} eyebrow="日本地図" title="観光スポットを地図から探す" className="mb-0" testId="home-japan-map-head" />
            <Link href={`#${SPOT_LIST_ID}`} prefetch={false} className="sr-only focus:not-sr-only focus:inline-flex focus:items-center focus:min-h-[44px] focus:text-text-2 focus:underline focus:underline-offset-4 jm-skip" data-testid="home-japan-map-skip">
                地図を飛ばして文字の一覧へ
            </Link>
            {/* スマホは普通の縦並び（帯が地図の下に貼り付く `position: sticky` の入れ物をここにする）。広い画面（768px〜）だけ2列 */}
            <div className="mt-3 md:grid md:grid-cols-[minmax(0,420px)_minmax(0,1fr)] md:gap-x-7 md:items-start">
                <div className="jm-col" style={{ "--jm-ar": MAP_W / MAP_H } as React.CSSProperties}>
                    {/* 地方チップ（実ボタン）。なぞれない人・キーボード・音声操作の主な道 */}
                    <div className="jm-chips" role="group" aria-label="地方" data-testid="home-japan-map-chips">
                        {CHIPS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                className={`jm-rchip${chipOn === c ? " jm-on" : ""}`}
                                aria-pressed={chipOn === c}
                                data-chip={c}
                                onClick={() => { if (c === "全国") goAll(); else goRegion(c); }}
                            >
                                {c}
                            </button>
                        ))}
                    </div>
                    {/* 固定欄: 触れている名前（札が指の下・画面の端で出せないときの保険・小さい県の確認）。読み上げは別（aria-live の文） */}
                    <div className="jm-bar" aria-hidden="true" data-testid="home-japan-map-bar">{bar}</div>
                    <div
                        ref={wrapRef}
                        className={`jm-wrap${dens ? " jm-dens" : ""}${tracing ? " jm-tracing" : ""}`}
                        role="group"
                        aria-label="日本地図。長押ししてなぞると名前が出ます。矢印キーで地方や県を移り、Enter で選びます。地方のボタンと、下の県の一覧からも選べます。"
                        tabIndex={rove === null ? undefined : stage === null ? 0 : -1}
                        data-testid="home-japan-map-wrap"
                        data-stage={stage ?? "all"}
                        data-zoom={moving ? "moving" : "still"}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                        onPointerLeave={onPointerLeave}
                        onClick={onClick}
                        onContextMenu={(e) => { if (gestureRef.current!.mode !== "idle" || (e.nativeEvent as PointerEvent).pointerType === "touch") e.preventDefault(); }}
                        onFocus={onFocus}
                        onBlur={onWrapBlur}
                        onKeyDown={onWrapKeyDown}
                    >
                        <svg
                            ref={svgRef}
                            className={`jm${stage === null ? " jm-all" : ""}`}
                            viewBox={`${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`}
                        >
                            {/*
                              * 県の形は <path> を直に置く（`<use>` にしない）。`vector-effect: non-scaling-stroke` は `<use>` の写しには効かず、
                              * 地方を拡大すると縁が拡大率（関東は約 6 倍）のぶん太くなった（2026-11-09 実測: 触れた県の白 2px が約 10px）。
                              * 触れた・選んだ県は最後に描く（隣の県の塗りに縁の半分を隠されない）
                              */}
                            <g aria-hidden="true">
                                {drawOrder.map(({ sh, cls }) => <path key={sh[0]} d={sh[1]} className={cls} />)}
                            </g>
                            <rect className={`jm-frame${hovSlug === "okinawa" ? " jm-frame-hov" : ""}`} x={fx} y={fy} width={fw} height={fh} rx={10} aria-hidden="true" style={{ opacity: stage === null ? 1 : 0 }} />
                            {/* 県ごとの本物のリンク（行き先は県の頁）。見た目と当たりは持たない（当たりは自前・`japanMapHit.ts`）。焦点の輪だけ描く。小さい県が上 */}
                            <g>
                                {LINK_ORDER.filter((sh) => among.has(sh[0])).map((sh) => (
                                    <Link
                                        key={sh[0]}
                                        href={ROUTES.SPOT_AREA(sh[0])}
                                        prefetch={false}
                                        aria-label={`${NAME.get(sh[0])}の観光スポット、${counts.get(sh[0])}件`}
                                        data-s={sh[0]}
                                        aria-expanded={rove === null ? undefined : sel === sh[0]}
                                        aria-controls={sel === sh[0] ? SHEET_ID : undefined}
                                        tabIndex={tabIdx(sh[0])}
                                    >
                                        {/* 当たりの箱（読み上げ・焦点の枠のための形）。`<use>` で形を写すと、写しが `jm-sh` の塗りを持って上から描き直してしまう（触れた・選んだ県の色が隠れた・2026-11-09 実測） */}
                                        <rect className="jm-hit" x={hitBox(sh)[0]} y={hitBox(sh)[1]} width={hitBox(sh)[2]} height={hitBox(sh)[3]} />
                                    </Link>
                                ))}
                            </g>
                            {/* 名前: 全国は地方名（16px 明朝）と「沖縄県」・拡大した地方は県の中に 14px */}
                            <g
                                aria-hidden="true"
                                className="jm-names"
                                style={{ "--jm-fs": `${REGION_LABEL_PX / s}px`, "--jm-sw": `${3.5 / s}px` } as React.CSSProperties}
                            >
                                {stage !== null && (
                                    members.map((slug) => {
                                        const l = LABEL_BY_SLUG.get(slug);
                                        if (!l) return null;
                                        const chars = [...l[1]];
                                        const step = REGION_LABEL_PX / s;
                                        return (
                                            <g key={slug} data-label={slug} className={sel === slug ? "jm-lab-sel" : undefined}>
                                                {l[2] === "h"
                                                    ? <text className="jm-name" x={l[3]} y={l[4]}>{l[1]}</text>
                                                    : chars.map((c, i) => <text key={i} className="jm-name" x={l[3]} y={Math.round((l[4] + (i - (chars.length - 1) / 2) * step) * 100) / 100}>{c}</text>)}
                                            </g>
                                        );
                                    })
                                )}
                            </g>
                            {/* 真鍮の内側 2px の輪（形に沿わせる: 県の形で切り抜いた 4px の線の内側半分） */}
                            {foc && (
                                <g aria-hidden="true">
                                    <clipPath id={`${uid}clip`}><path d={PREFECTURE_SHAPES.find((x) => x[0] === foc)![1]} /></clipPath>
                                    <path d={PREFECTURE_SHAPES.find((x) => x[0] === foc)![1]} className="jm-ring" clipPath={`url(#${uid}clip)`} style={{ strokeWidth: 4 }} />
                                </g>
                            )}
                        </svg>
                        {/*
                          * 全国の地方名は押せる札（2026-11-12）。1回押せばその地方が開く（北海道・沖縄は県を選ぶ）。
                          * 長押し・横になぞると、札の上から始めても地図のなぞりになる（`pointerdown` は枠へ届く）。
                          * 読み上げ・Tab は上の地方チップ（実ボタン）が持つので、ここは指とマウスの近道（aria-hidden・tabIndex -1）。
                          * 拡大・縮小の動きの途中は出さない（札が動きの途中の地図とずれる）
                          */}
                        {stage === null && !moving && (
                            <div className="jm-rlabels" aria-hidden="true" data-testid="home-japan-map-regions">
                                {REGION_ORDER.map((r) => {
                                    const [x, y] = regionLabelAt(r);
                                    const on = hovRegion === r || (hovSlug !== null && regionOf(hovSlug) === r);
                                    return (
                                        <button
                                            key={r}
                                            type="button"
                                            tabIndex={-1}
                                            className={`jm-rlabel${on ? " jm-on" : ""}`}
                                            style={{ left: `${(x / MAP_W) * 100}%`, top: `${(y / MAP_H) * 100}%` }}
                                            data-r={r}
                                            data-testid="home-japan-map-region"
                                            onClick={(e) => {
                                                e.stopPropagation(); // 枠の click（地図のタップ）で二重に開かない
                                                tapRef.current = null;
                                                if (tracingRef.current || Date.now() - lastCommitRef.current < 400) return; // なぞって離した直後の click は、なぞりの結果を優先
                                                goRegion(r);
                                            }}
                                        >
                                            {r === "沖縄" ? "沖縄県" : r}<span aria-hidden="true">›</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* 帯（スマホは地図の下に貼り付く常設の枠 164px・広い画面は右の札）。押し出さない・地図の高さは変えない */}
                <div
                    id={SHEET_ID}
                    ref={sheetRef}
                    tabIndex={-1}
                    role="region"
                    aria-label={selName ? `${selName}の観光スポット` : "観光スポットの一覧"}
                    data-open={sel ? "true" : "false"}
                    className="jm-sheet md:mt-0 md:sticky md:top-20"
                    data-testid="home-japan-map-panel"
                >
                    {sel && selName ? (
                        <>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "28px" }}>{selName}</h3>
                                    <p className="m-0 mt-0.5 text-text-2 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }}>観光スポット {selCount}件</p>
                                </div>
                                <button type="button" className="jm-close" aria-label="観光スポットの一覧を閉じる" data-testid="home-japan-map-close" onClick={() => closeSheet(true)}>
                                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                                </button>
                            </div>
                            {selCount === 0 && <p className="m-0 mt-1 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>この県の観光スポットは、まだ登録がありません。近くの県を見る</p>}
                            {selTops.length > 0 && (
                                <p className="jm-names-line m-0 mt-1 truncate text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>{selTops.map((t) => t[1]).join("・")} ほか</p>
                            )}
                            {selTops.length > 0 && (
                                <ul className="jm-spots m-0 mt-2 p-0 list-none" data-testid="home-japan-map-spots">
                                    {selTops.map((t) => (
                                        <li key={t[0]}>
                                            <Link href={`/spots/${t[0]}`} prefetch={false} className="jm-spot" onClick={rememberMap}>
                                                <span className="min-w-0">
                                                    <span className="block truncate font-semibold text-white" style={{ fontSize: "15px", lineHeight: "20px" }}>{t[1]}</span>
                                                    {t[2] && <span className="block truncate text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>{t[2]}</span>}
                                                </span>
                                                <span aria-hidden="true" className="text-text-3">›</span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {selCount > 0 && (
                                <TrackedLink href={ROUTES.SPOT_AREA(sel)} className="jm-open" data-testid="home-japan-map-open" navArea="home_entry" navDest="map_pref" onClick={rememberMap}>
                                    <span>{selName}の観光スポットをすべて見る</span><span aria-hidden="true">›</span>
                                </TrackedLink>
                            )}
                            <div className={`jm-near${selCount === 0 ? " jm-near-keep" : ""}`}>
                                <p className="m-0 mt-2.5 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>近くの県</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {selNear.map((n) => (
                                        <button key={n} type="button" className="jm-chip" onClick={() => { focusSheetPending.current = true; selectPref(n, true); }}>{NAME.get(n)}</button>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            {/* 何も選んでいないとき: 命令（「県を選ぶ」）ではなく、押すとここに何が出るか（2026-11-12 owner） */}
                            <h3 className="m-0 font-serif font-bold text-white" style={{ fontSize: "20px", lineHeight: "26px" }}>{stage ? `${stage}の県` : "県の観光スポット"}</h3>
                            <p className="m-0 mt-0.5 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }} data-testid="home-japan-map-panel-note">
                                {stage ? "県を押すと、ここに観光スポットが出ます" : "地方を押し、県を押すと、ここに出ます"}
                            </p>
                            <button
                                ref={listBtnRef}
                                type="button"
                                className="jm-tlink"
                                aria-expanded={listOpen}
                                aria-controls={LIST_ID}
                                data-testid="home-japan-map-list-toggle"
                                onClick={() => setListOpen((o) => !o)}
                            >
                                県の一覧から選ぶ <span aria-hidden="true">{listOpen ? "‹" : "›"}</span>
                            </button>
                        </>
                    )}
                </div>
                {/* 開閉・拡大の確定を読み上げる（焦点は動かさない）。なぞり中の名前は読まない */}
                <p className="sr-only" role="status" aria-live="polite" data-testid="home-japan-map-status">{announce}</p>

                <div className="md:col-start-1">
                    {/* 県の一覧チップ（地図の外・全県・地方ごと）。触れる・焦点を当てると地図の県が強調される */}
                    <button
                        type="button"
                        className="jm-tlink jm-tlink-b"
                        aria-expanded={listOpen}
                        aria-controls={LIST_ID}
                        onClick={() => setListOpen((o) => !o)}
                    >
                        県の一覧から選ぶ <span aria-hidden="true">{listOpen ? "‹" : "›"}</span>
                    </button>
                    <div id={LIST_ID} className="jm-list" hidden={!listOpen} data-testid="home-japan-map-list" onMouseLeave={() => { if (hovRef.current && !tracingRef.current) setHov(null); }}>
                        {REGION_ORDER.map((r) => (
                            <div key={r} role="group" aria-label={r} className="jm-list-g">
                                <p className="m-0 jm-list-h" aria-hidden="true">{r}</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {membersOf(r).filter((x) => among.has(x)).map((slug) => (
                                        <button
                                            key={slug}
                                            type="button"
                                            className={`jm-chip jm-pick${sel === slug ? " jm-on" : ""}`}
                                            data-pick={slug}
                                            aria-pressed={sel === slug}
                                            aria-label={`${NAME.get(slug)}、${counts.get(slug) ?? 0}件`}
                                            onClick={() => { setHov(null); selectPref(slug, true); }}
                                            onMouseEnter={() => setHov({ k: "pref", slug })}
                                            onFocus={() => setHov({ k: "pref", slug })}
                                            onBlur={() => setHov(null)}
                                        >
                                            {SHORT(slug)}<span className="jm-pick-n tabular-nums" aria-hidden="true">{counts.get(slug) ?? 0}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <Link href={`#${SPOT_LIST_ID}`} prefetch={false} className="jm-link" data-testid="home-japan-map-textlink">すべての県を文字で見る ›</Link>
                    <label className="jm-dens-label flex items-center gap-2 min-h-[44px] text-text-2" style={{ fontSize: "13px" }}>
                        <input type="checkbox" className="w-5 h-5 m-0" style={{ accentColor: "#b8955a" }} checked={dens} onChange={(e) => setDens(e.target.checked)} />
                        件数の濃淡を付ける
                    </label>
                    {dens && (
                        <div className="jm-legend flex flex-wrap gap-x-3.5 gap-y-1.5 pb-1.5 text-text-2" style={{ fontSize: "12px", lineHeight: "16px" }} data-testid="home-japan-map-legend">
                            {legend.map((t, i) => (
                                <span key={t} className="inline-flex items-center gap-1.5"><i style={{ background: LEGEND_FILL[i] }} />{t}</span>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {/* 指の輪・進み具合の輪・名前の札（画面に固定・`document.body` へ。祖先の transform に影響されない） */}
            {mounted && createPortal(
                <>
                    <div ref={progRef} className="jm-prog" hidden aria-hidden="true">
                        <svg width="54" height="54" viewBox="0 0 54 54"><circle cx="27" cy="27" r="25" /></svg>
                    </div>
                    <div ref={ringRef} className="jm-finger" hidden={!tracing} aria-hidden="true" />
                    <div
                        ref={tipRef}
                        className={`jm-tip${tip?.cancel ? " jm-cancel" : ""}`}
                        hidden={!tip || !(tracing || mouseOn)}
                        aria-hidden="true"
                        data-testid="home-japan-map-tip"
                    >
                        {tip && <><b>{tip.n}</b><span>{tip.sub}</span></>}
                    </div>
                </>,
                document.body,
            )}
        </section>
    );
}
