"use client";

// app/components/HomeJapanMap.tsx
//
// **ホームの「撮影スポットを地図から探す」**（2026-11-09・owner「任せる」・デザイナーの提案書 案D+A）。
// 実形の日本地図で県を選ぶ入口。**ホームの写真のタブの面より上**（札・アプリの案内の下）に置く
// （owner の懸念: 写真の並びが長くて地図に辿り着けず離脱するのがいちばん悲しい）。
// 文字リンクの一覧（`HomeSpotEntry`・国内と海外）はホームの下に今のまま残す——SEO と、小さな県の保険。
//
// 🔴 **クライアント部品にしているのは `HomeSpotEntry` と同じ判断**。サーバー部品で 47 本の形を並べると
// RSC ペイロードに要素の木がもう1本入り、HTML が二重に太る。形のデータは部品の JS が持ち、
// サーバーで描いた HTML には 47 本の本物の `<a href>` がそのまま出る。渡すのは県のスラッグと件数だけ。
//
// 作り（提案書のとおり。2026-11-09 の2回目で操作を作り直した——下の「操作」）:
//   - 各県は本物のリンク（行き先は県の頁・`ROUTES.SPOT_AREA`）。JS が効く前・新しいタブ・読み上げの「リンク」はそのまま県の頁へ行く
//   - **県名は地図に常に載せる**（owner「地図に県の名前をつけ忘れている」）。字は画面で 12px・白に黒の縁取り。
//     県の中に収まる県はその中、収まらない小さな県（関東・近畿・瀬戸内）は海に出して**引き出し線**でつなぐ。
//     置き場は `lib/data/prefectureLabels.ts`（`scripts/generate-prefecture-labels.ts` が作る生成物）。
//     引き出した字は県の当たりにもなる（小さな県を字で押せる）
//   - 拡大: ＋ − 全体（**左上**・沖縄の枠を覆わない）・ダブルクリック・Ctrl+ホイール・ドラッグ・ピンチ
//   - キーボード: Tab で地図に入ると止まり先は1か所（北海道）・矢印キーで隣の県・Enter で一覧を開く・Esc で閉じる。
//     先頭に「地図を飛ばして文字の一覧へ」。県ごとに名前付きのリンク（読み上げは「神奈川県の撮影スポット、63件」）。
//     フォーカスの輪は真鍮の内側 2px（形に沿う）
//   - 色だけに頼らない: 選んだ県は縁も太くなる。件数の濃淡は**初期オフ**（チェックで切り替え・凡例つき）
//   - 沖縄は枠に入れて右下へ・縮尺は本土と同じ（枠の字は「沖縄県」だけ。長いと島に重なる）。海外は今の国の一覧のまま（世界地図は別案）
//
// 操作（2026-11-09 owner「地図は操作感を大事に。押して、撮影スポットが出て、戻るのも楽に」）:
//   - **県を押しても頁を移動しない。** 同じ頁で、その県の撮影スポットの上位の数件と「すべて見る」を出す
//     （スマホは地図の下に貼り付くシート・広い画面は地図の右の札）。選んだ県は地図で強調。
//     別の県を押せばその場で切り替わり、同じ県をもう一度押す・✕・Esc で閉じる
//     （以前は 44px 以上の県は押すと直接移動・小さい県は札だった。移動を前提にした「大きさで分ける」は要らなくなった——
//      間違えて押しても、別の県を押すだけで直る）
//   - **URL に選択県（`#pref=kanagawa`）を持たせる。** 開くとき履歴を1件積む（戻る＝閉じる）・切り替えは差し替え・
//     一覧の頁へ進んで戻ると同じ県の一覧が開いたまま。履歴の書き方は `withNextHistoryState`（Next の popstate が再読込に落ちない作法）
//   - 一覧は静的データ（`homeMapTopSpots`・ビルドで焼く）。新しい API・費用は無い
//   - シートがスマホの画面の下を覆うので、開いた県が覆われる位置なら頁を少し動かして見える所へ寄せる
// 高さ: スマホで画面の 7 割まで（`globals.css` の `jm-wrap`・県名が読める大きさを確保するため 6 割から広げた）。
// **縦のスクロールを奪わない**ため、拡大していないあいだは `touch-action: pan-y`。拡大中だけ `none`。
//
// 計測（`nav_click`・`area: home_entry`）: `dest: map_pref_select`（県を押した・選び直しも）/ `map_sheet_open`（閉じた状態から開いた）/
// `map_spot`（一覧のスポットを押した）/ `map_pref`（「すべて見る」・新しいタブなどで県の頁へ行った）。
// 札を出すだけの操作・拡大・濃淡は数えない。県の名前・URL・スポットの slug は送らない。

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { HomeAreaRow } from "@/lib/data/homeSpotEntry";
import { PREFECTURES } from "@/lib/data/prefectures";
import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "@/lib/data/prefectureShapes";
import { PREFECTURE_LABELS } from "@/lib/data/prefectureLabels";
import type { AreaTopSpot } from "@/lib/data/spotLink";
import {
    NEAR_TAP_PX, ZOOM_MAX, ZOOM_MIN, clampView, densityBin, densityCuts, nearestByBox,
    nearestSlugs, neighborInDirection, prefFromHash, prefHash, shapeOf, type MapView,
} from "@/lib/utils/japanMap";
import { withNextHistoryState } from "@/lib/utils/historyState";
import { clearMapReturn, readMapReturn, saveMapReturn } from "@/lib/utils/mapReturn";
import { ROUTES } from "@/lib/routes";
import SectionHead from "./SectionHead";
import TrackedLink from "./TrackedLink";
import { track } from "@/lib/utils/analytics";

const HEADING_ID = "home-japan-map-h";
const SHEET_ID = "home-japan-map-sheet";
/** ページ内リンクの行き先（`HomeSpotEntry` の `<nav>`） */
export const SPOT_LIST_ID = "home-spot-entry-list";

const NAME = new Map(PREFECTURES.map((p) => [p.slug, p.name]));
const STEP = 1.6;

/** 重なったとき小さな県が上に来る並び（大きい県が先・DOM の後ろが上） */
const LINK_ORDER = [...PREFECTURE_SHAPES].sort((a, b) => b[2][2] * b[2][3] - a[2][2] * a[2][3]);

const ARROWS: Record<string, readonly [number, number]> = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

function slugOf(target: EventTarget | null): string | null {
    const a = target instanceof Element ? target.closest("a[data-s]") : null;
    return a ? a.getAttribute("data-s") : null;
}

/** リンク、または縁の当たり（halo）の県。マウスの札に使う */
function slugOrHaloOf(target: EventTarget | null): string | null {
    const s = slugOf(target);
    if (s) return s;
    return target instanceof Element && target.classList.contains("jm-halo") ? target.getAttribute("data-s") : null;
}

const LABEL_BY_SLUG = new Map(PREFECTURE_LABELS.map((l) => [l[0], l]));
/** 県名の字の大きさ（画面の px）と、引き出した字の当たりの余白 */
const LABEL_PX = 12;
const LABEL_HIT_PAD_PX = 4;

/** 字の枠（viewBox の単位）。`perUnit` = 画面の px ÷ 単位。縦書きは1字ずつ縦に積む */
function labelBox(l: (typeof PREFECTURE_LABELS)[number], perUnit: number, padPx = 0) {
    const fs = LABEL_PX / perUnit, line = fs * 1.12, n = [...l[1]].length, pad = padPx / perUnit;
    const w = (l[2] === "h" ? n * fs : line) / 2 + pad, h = (l[2] === "h" ? line : n * fs) / 2 + pad;
    return { x: l[3] - w, y: l[4] - h, w: w * 2, h: h * 2, fs };
}

/**
 * 県名の1つ分（引き出し線＋点＋字）。見た目だけ（読み上げは県のリンクの名前・当たりはリンクの側）。
 * 字の大きさ・縁取りの太さは親の `--jm-fs` / `--jm-sw`（画面で 12px / 3px になる単位）から読む
 * （1字ごとに style を書くと HTML が約 5KB 太る）。位置揃えは CSS（`.jm-name`）
 */
function LabelMark({ l, perUnit, on }: { l: (typeof PREFECTURE_LABELS)[number]; perUnit: number; on: boolean }) {
    const fs = LABEL_PX / perUnit;
    const chars = [...l[1]];
    const r = (n: number) => Math.round(n * 100) / 100;
    return (
        <g className={on ? "jm-lab-sel" : undefined} data-label={l[0]}>
            {l[5] !== null && l[6] !== null && (
                <>
                    <line className="jm-lead" x1={l[3]} y1={l[4]} x2={l[5]} y2={l[6]} />
                    <circle className="jm-lead-dot" cx={l[5]} cy={l[6]} r={r(1.8 / perUnit)} />
                </>
            )}
            {l[2] === "h" ? (
                <text className="jm-name" x={l[3]} y={l[4]}>{l[1]}</text>
            ) : (
                chars.map((c, i) => <text key={i} className="jm-name" x={l[3]} y={r(l[4] + (i - (chars.length - 1) / 2) * fs)}>{c}</text>)
            )}
        </g>
    );
}

/** 海へ引き出した県名のまわりの当たり（県のリンクの中に置く）。県の中に置いた字は県の形が当たりなので要らない */
function LabelHit({ slug, perUnit }: { slug: string; perUnit: number }) {
    const l = LABEL_BY_SLUG.get(slug);
    if (!l || l[5] === null) return null;
    const b = labelBox(l, perUnit, LABEL_HIT_PAD_PX);
    return <rect className="jm-hit" x={b.x} y={b.y} width={b.w} height={b.h} />;
}

/** 一覧を開いたときの履歴の印（戻る＝閉じる）。`history.state` に載せる */
const PUSHED_KEY = "jmPref";

export default function HomeJapanMap({ areas, tops = {} }: { areas: readonly HomeAreaRow[]; tops?: Readonly<Record<string, readonly AreaTopSpot[]>> }) {
    const uid = useId().replace(/:/g, "");
    const counts = useMemo(() => new Map(areas), [areas]);
    const among = useMemo(() => new Set(counts.keys()), [counts]);
    const cuts = useMemo(() => densityCuts([...counts.values()]), [counts]);
    const ids = useMemo(() => new Map(PREFECTURE_SHAPES.map((s, i) => [s[0], `${uid}p${i}`])), [uid]);

    const [sel, setSel] = useState<string | null>(null);
    const [hov, setHov] = useState<string | null>(null);
    const [foc, setFoc] = useState<string | null>(null);
    /** 止まり先の県（roving tabindex）。JS が効くまで null＝47本とも普通のリンク */
    const [rove, setRove] = useState<string | null>(null);
    const [view, setView] = useState<MapView>({ z: 1, x: 0, y: 0 });
    const [dens, setDens] = useState(false);
    /** 拡大していないときの 1 単位あたりの px（ResizeObserver） */
    const [px, setPx] = useState(1);

    const svgRef = useRef<SVGSVGElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef(view);
    viewRef.current = view;
    const pxRef = useRef(px);
    pxRef.current = px;
    const moved = useRef(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const selRef = useRef(sel);
    selRef.current = sel;
    /** 押して開いた直後に、県が覆われないよう頁を寄せる対象（URL から戻したときは動かさない） */
    const revealPending = useRef<string | null>(null);
    /** 開いたのがキーボードなら、一覧へ焦点を移す（Esc で県へ戻す） */
    const focusSheetPending = useRef(false);

    const zoomed = view.z > 1;
    const perUnit = px * view.z;

    const applyView = useCallback((v: MapView) => setView(clampView(v, MAP_H)), []);

    useEffect(() => { setRove("hokkaido"); }, []);

    // 幅の変化を追う（拡大前の px / 単位）
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const read = () => { const w = el.getBoundingClientRect().width; if (w > 0) setPx(w / MAP_W); };
        read();
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(read);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    /** 画面の座標 → 地図の座標 */
    const toMap = useCallback((cx: number, cy: number): [number, number] => {
        const r = svgRef.current?.getBoundingClientRect();
        const v = viewRef.current;
        if (!r || r.width === 0) return [0, 0];
        return [v.x + ((cx - r.left) / r.width) * (MAP_W / v.z), v.y + ((cy - r.top) / r.height) * (MAP_H / v.z)];
    }, []);

    /** 画面の (cx, cy) を動かさずに拡大・縮小する */
    const zoomAt = useCallback((nz: number, cx: number, cy: number) => {
        const v = viewRef.current;
        const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nz));
        const r = svgRef.current?.getBoundingClientRect();
        if (!r || r.width === 0) { applyView({ ...v, z }); return; }
        const fx = (cx - r.left) / r.width;
        const fy = (cy - r.top) / r.height;
        const mx = v.x + fx * (MAP_W / v.z);
        const my = v.y + fy * (MAP_H / v.z);
        applyView({ z, x: mx - fx * (MAP_W / z), y: my - fy * (MAP_H / z) });
    }, [applyView]);

    /** 県が見える窓の外・縁に寄っていたら、その県が真ん中に来るよう動かす */
    const reveal = useCallback((slug: string) => {
        const v = viewRef.current;
        const s = shapeOf(slug);
        if (!s || v.z <= 1) return;
        const w = MAP_W / v.z, h = MAP_H / v.z;
        const sx = (s[3][0] - v.x) / w, sy = (s[3][1] - v.y) / h;
        if (sx < 0.08 || sx > 0.92 || sy < 0.08 || sy > 0.92) applyView({ z: v.z, x: s[3][0] - w / 2, y: s[3][1] - h / 2 });
    }, [applyView]);

    /** 履歴の state に印を付けて書く。Next の popstate が再読込に落ちない作法（`withNextHistoryState`） */
    const writeUrl = useCallback((slug: string | null, mode: "push" | "replace") => {
        try {
            const base = window.location.pathname + window.location.search;
            const url = slug ? base + prefHash(slug) : base;
            const state = withNextHistoryState(slug ? { [PUSHED_KEY]: mode === "push" ? 1 : (window.history.state?.[PUSHED_KEY] ?? 0) } : {});
            if (!slug) delete state[PUSHED_KEY]; // 閉じた状態の履歴に印は残さない（`withNextHistoryState` は印を持ち越す）
            if (mode === "push") window.history.pushState(state, "", url);
            else window.history.replaceState(state, "", url);
        } catch { /* 履歴が書けない環境でも一覧は開く */ }
    }, []);

    /** 閉じる。自分が積んだ履歴なら戻して消す（閉じたあとの「戻る」が空振りしない）。`refocus` は県のリンクへ焦点を戻す */
    const closeSheet = useCallback((refocus = false) => {
        const cur = selRef.current;
        if (cur === null) return;
        setSel(null);
        revealPending.current = null;
        clearMapReturn();
        if (refocus) svgRef.current?.querySelector<SVGAElement>(`a[data-s="${cur}"]`)?.focus({ preventScroll: true });
        try {
            if (window.history.state?.[PUSHED_KEY] === 1 && window.location.hash === prefHash(cur)) window.history.back();
            else if (window.location.hash) writeUrl(null, "replace");
        } catch { /* 同上 */ }
    }, [writeUrl]);

    /**
     * 県を押した（地図・字・近くの県の札）。閉じているなら開く（履歴を1件積む）・別の県なら切り替える（差し替え）・
     * 同じ県なら閉じる。`byKey` はキーボード（Enter）で開いたとき＝一覧へ焦点を移す
     */
    const press = useCallback((slug: string, byKey = false) => {
        const cur = selRef.current;
        track("nav_click", { area: "home_entry", dest: "map_pref_select" });
        if (cur === slug) { closeSheet(true); return; }
        if (cur === null) track("nav_click", { area: "home_entry", dest: "map_sheet_open" });
        setSel(slug);
        revealPending.current = slug;
        focusSheetPending.current = byKey;
        reveal(slug);
        writeUrl(slug, cur === null ? "push" : "replace");
    }, [reveal, writeUrl, closeSheet]);

    // URL（`#pref=…`）から選択県を戻す: 最初の描画のあと・戻る/進む・ハッシュの変更。一覧の頁から戻ったときもここ
    useEffect(() => {
        const sync = () => setSel(prefFromHash(window.location.hash, among));
        sync();
        // iOS Safari の戻る（bfcache）は頁ごと元の状態で戻る（`pageshow` の persisted）。ハッシュと食い違っていたら合わせる
        const onShow = (e: PageTransitionEvent) => { if (e.persisted) sync(); };
        window.addEventListener("popstate", sync);
        window.addEventListener("hashchange", sync);
        window.addEventListener("pageshow", onShow);
        return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); window.removeEventListener("pageshow", onShow); };
    }, [among]);

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

    // 押して開いた直後: キーボードなら一覧へ焦点・スマホなら、貼り付いたシートに県が隠れないよう頁を寄せる
    useEffect(() => {
        const slug = revealPending.current;
        if (!sel || sel !== slug) return;
        revealPending.current = null;
        if (focusSheetPending.current) { focusSheetPending.current = false; sheetRef.current?.focus({ preventScroll: true }); }
        const sheet = sheetRef.current, svg = svgRef.current, sh = shapeOf(sel);
        if (!sheet || !svg || !sh || typeof window.matchMedia !== "function") return;
        if (!window.matchMedia("(max-width: 639.98px)").matches) return; // 広い画面は札が右にあり、地図を覆わない
        const r = svg.getBoundingClientRect(), v = viewRef.current;
        // 県の中心＋外接箱の高さの半分（上限 40px）の位置を、シートの上に出す（県の下側がシートに潜らないように）
        const k = r.height / (MAP_H / v.z);
        const cy = r.top + (sh[3][1] - v.y) * k + Math.min((sh[2][3] * k) / 2, 40);
        const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-bar-h")) || 84;
        const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 56;
        const covered = sheet.getBoundingClientRect().height + bar + 8;
        const lo = header + 24, hi = window.innerHeight - covered - 40;
        if (hi <= lo) return;
        const delta = cy > hi ? cy - hi : cy < lo ? cy - lo : 0;
        if (delta !== 0) {
            const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            window.scrollBy({ top: delta, behavior: calm ? "auto" : "smooth" });
        }
    }, [sel]);

    // Ctrl/⌘+ホイールで拡大（passive でないリスナーが要る。ふつうのホイールはページのスクロールに任せる）
    useEffect(() => {
        const el = svgRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            zoomAt(viewRef.current.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [zoomAt]);

    // ---- リンク ----
    const onLinkClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
        const slug = e.currentTarget.getAttribute("data-s");
        if (!slug) return;
        // 新しいタブへ・中ボタン・修飾キーつきは、本物のリンクとして県の頁へ（これだけ「移動」として数える）
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
            track("nav_click", { area: "home_entry", dest: "map_pref" });
            return;
        }
        // ふつうの押下・Enter（detail 0）・読み上げの操作は、頁を移動せず一覧を出す
        e.preventDefault();
        press(slug, e.detail === 0);
    }, [press]);

    // ---- 指・マウス ----
    const pts = useRef(new Map<number, [number, number]>());
    const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
    const pinch = useRef<{ d: number; z: number } | null>(null);

    const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
        pts.current.set(e.pointerId, [e.clientX, e.clientY]);
        moved.current = false;
        if (pts.current.size === 2) {
            const [a, b] = [...pts.current.values()];
            pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: viewRef.current.z };
            drag.current = null;
        } else if (viewRef.current.z > 1) {
            drag.current = { x: e.clientX, y: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y };
        }
    };
    const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
        // マウスの札（名前と件数）。位置は直接書き換える（動くたびに描き直さない）
        if (e.pointerType === "mouse") {
            setHov(slugOrHaloOf(e.target));
            const wr = wrapRef.current?.getBoundingClientRect();
            if (wr && tipRef.current) {
                tipRef.current.style.left = `${e.clientX - wr.left}px`;
                tipRef.current.style.top = `${e.clientY - wr.top}px`;
            }
        }
        if (!pts.current.has(e.pointerId)) return;
        pts.current.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.current.size === 2 && pinch.current) {
            const [a, b] = [...pts.current.values()];
            zoomAt(pinch.current.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.current.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
            moved.current = true;
        } else if (drag.current) {
            const r = svgRef.current?.getBoundingClientRect();
            if (!r || r.width === 0) return;
            const k = (MAP_W / viewRef.current.z) / r.width;
            const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 6) {
                if (!moved.current) svgRef.current?.setPointerCapture?.(e.pointerId);
                moved.current = true;
            }
            if (moved.current) applyView({ z: viewRef.current.z, x: drag.current.vx - dx * k, y: drag.current.vy - dy * k });
        }
    };
    const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
        pts.current.delete(e.pointerId);
        if (pts.current.size < 2) pinch.current = null;
        if (pts.current.size === 0) drag.current = null;
    };

    /** ドラッグのあとに来るクリックは、移動にも札にも使わない */
    const onClickCapture = (e: React.MouseEvent<SVGSVGElement>) => {
        if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; }
    };
    /** リンクの外（海・県の縁）のタップ: 縁の当たり（halo）か、14px 以内でいちばん近い県の札 */
    const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
        if (slugOf(e.target)) return; // リンクは `onLinkClick`
        const t = e.target as Element;
        const h = slugOrHaloOf(t);
        if (h) { press(h); return; }
        const [x, y] = toMap(e.clientX, e.clientY);
        const near = nearestByBox(x, y, NEAR_TAP_PX / (pxRef.current * viewRef.current.z), among);
        if (near) press(near);
    };
    const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
        e.preventDefault();
        zoomAt(viewRef.current.z >= 3 ? 1 : viewRef.current.z * 2, e.clientX, e.clientY);
    };

    // ---- キーボード ----
    const onFocus = (e: React.FocusEvent<SVGSVGElement>) => {
        const slug = slugOf(e.target);
        if (!slug) return;
        setRove(slug);
        let visible = true;
        try { visible = (e.target as Element).matches(":focus-visible"); } catch { /* 古いブラウザは輪を出す */ }
        if (!visible) return; // マウスで押したときの焦点には輪も札も出さない（押した結果は `onLinkClick`）
        setFoc(slug);
        reveal(slug);
    };
    const onBlur = (e: React.FocusEvent<SVGSVGElement>) => {
        if (slugOf(e.target)) setFoc(null);
    };
    const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
        const slug = slugOf(e.target);
        if (!slug) return;
        const dir = ARROWS[e.key];
        if (dir) {
            e.preventDefault();
            const to = neighborInDirection(slug, dir[0], dir[1], among);
            if (to) svgRef.current?.querySelector<SVGAElement>(`a[data-s="${to}"]`)?.focus();
        }
    };

    // ---- 拡大のボタン ----
    const zoomButton = (kind: "in" | "out" | "reset") => {
        if (kind === "reset") { applyView({ z: 1, x: 0, y: 0 }); return; }
        const r = svgRef.current?.getBoundingClientRect();
        if (!r) return;
        // 選んでいる県があればその県を、無ければ見えている窓の真ん中を中心に
        const s = sel ? shapeOf(sel) : undefined;
        const v = viewRef.current;
        const cx = s ? r.left + ((s[3][0] - v.x) / (MAP_W / v.z)) * r.width : r.left + r.width / 2;
        const cy = s ? r.top + ((s[3][1] - v.y) / (MAP_H / v.z)) * r.height : r.top + r.height / 2;
        zoomAt(v.z * (kind === "in" ? STEP : 1 / STEP), cx, cy);
    };

    const vbW = MAP_W / view.z, vbH = MAP_H / view.z;
    const [fx, fy, fw, fh] = OKINAWA_FRAME;
    const hovName = hov ? NAME.get(hov) : null;
    const selName = sel ? NAME.get(sel) : null;
    const selNear = sel ? nearestSlugs(sel, 3, among) : [];
    const selTops = (sel && tops[sel]) || [];
    const legend = [
        `〜${cuts[0]}件`, `${cuts[0] + 1}〜${cuts[1]}件`, `${cuts[1] + 1}〜${cuts[2]}件`, `${cuts[2] + 1}件〜`,
    ];
    const LEGEND_FILL = ["#1e1a12", "#3b301d", "#6b5937", "#a8864f"];

    return (
        <section
            aria-labelledby={HEADING_ID}
            className="pt-2 pb-6 text-white"
            data-testid="home-japan-map"
            onKeyDown={(e) => { if (e.key === "Escape" && selRef.current) { e.preventDefault(); closeSheet(true); } }}
        >
            <SectionHead id={HEADING_ID} eyebrow="PHOTO SPOTS" title="撮影スポットを地図から探す" className="mb-0" testId="home-japan-map-head" />
            <p className="m-0 mt-2 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>
                県を押すと、その県の撮影スポットの一覧が出ます。数字は掲載している件数です。
            </p>
            <a href={`#${SPOT_LIST_ID}`} className="sr-only focus:not-sr-only focus:inline-flex focus:items-center focus:min-h-[44px] focus:text-text-2 focus:underline focus:underline-offset-4 jm-skip" data-testid="home-japan-map-skip">
                地図を飛ばして文字の一覧へ
            </a>
            {/* スマホは普通の縦並び（シートが地図の下に貼り付く `position: sticky` の入れ物をここにする）。広い画面だけ2列 */}
            <div className="mt-3 sm:grid sm:grid-cols-[minmax(0,420px)_minmax(0,1fr)] sm:gap-x-7 sm:items-start">
                <div
                    ref={wrapRef}
                    className={`jm-wrap${zoomed ? " jm-zoomed" : ""}${dens ? " jm-dens" : ""}`}
                    style={{ "--jm-ar": MAP_W / MAP_H } as React.CSSProperties}
                    data-testid="home-japan-map-wrap"
                >
                    <svg
                        ref={svgRef}
                        className="jm"
                        viewBox={`${view.x.toFixed(1)} ${view.y.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`}
                        role="group"
                        aria-label="日本の地図。県を押すと、その県の撮影スポットの一覧が出ます。同じ内容の文字の一覧はページの下にあります。"
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHov(null); }}
                        onClickCapture={onClickCapture}
                        onClick={onSvgClick}
                        onDoubleClick={onDoubleClick}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        onKeyDown={onKeyDown}
                    >
                        <defs>
                            {PREFECTURE_SHAPES.map((s) => <path key={s[0]} id={ids.get(s[0])} d={s[1]} />)}
                        </defs>
                        <g aria-hidden="true">
                            {PREFECTURE_SHAPES.map((s) => {
                                const n = counts.get(s[0]);
                                const cls = ["jm-sh"];
                                if (dens && n !== undefined) cls.push(`jm-b${densityBin(n, cuts)}`);
                                if (hov === s[0]) cls.push("jm-hov");
                                if (sel === s[0]) cls.push("jm-sel");
                                return <use key={s[0]} href={`#${ids.get(s[0])}`} className={cls.join(" ")} />;
                            })}
                        </g>
                        {/* 縁の当たり: 見えない太い線（10px）。県の縁の外 5px までが、その県の札になる */}
                        <g aria-hidden="true">
                            {LINK_ORDER.filter((s) => among.has(s[0])).map((s) => (
                                <use key={s[0]} href={`#${ids.get(s[0])}`} className="jm-halo" data-s={s[0]} />
                            ))}
                        </g>
                        <rect className="jm-frame" x={fx} y={fy} width={fw} height={fh} rx={10} aria-hidden="true" />
                        <text className="jm-frame-label" x={fx + 10} y={fy + 20} aria-hidden="true" style={{ fontSize: 12 / perUnit }}>
                            沖縄県
                        </text>
                        {/* 県ごとの本物のリンク。読み上げは「神奈川県の撮影スポット、63件」。小さい県が上 */}
                        <g>
                            {LINK_ORDER.filter((s) => among.has(s[0])).map((s) => (
                                <Link
                                    key={s[0]}
                                    href={ROUTES.SPOT_AREA(s[0])}
                                    prefetch={false}
                                    aria-label={`${NAME.get(s[0])}の撮影スポット、${counts.get(s[0])}件`}
                                    data-s={s[0]}
                                    aria-expanded={rove === null ? undefined : sel === s[0]}
                                    aria-controls={sel === s[0] ? SHEET_ID : undefined}
                                    tabIndex={rove === null ? undefined : rove === s[0] ? 0 : -1}
                                    onClick={onLinkClick}
                                >
                                    {s[0] === "okinawa" && <rect className="jm-hit" x={fx} y={fy} width={fw} height={fh} />}
                                    <use href={`#${ids.get(s[0])}`} className="jm-hit" />
                                    {/* 海へ引き出した県名は、字のまわりも当たりにする（小さな県を字で押せる）。JS が効いてから（JS なしの頁は行き先が県の頁なので当たりの広げは要らない・HTML を太らせない） */}
                                    {rove !== null && <LabelHit slug={s[0]} perUnit={perUnit} />}
                                </Link>
                            ))}
                        </g>
                        {/* 県名（常に・字は画面で 12px）。県の中に収まらない県は海へ出して引き出し線でつなぐ（置き場は生成物） */}
                        <g aria-hidden="true" className="jm-names" style={{ "--jm-fs": `${LABEL_PX / perUnit}px`, "--jm-sw": `${3 / perUnit}px` } as React.CSSProperties}>
                            {PREFECTURE_LABELS.filter((l) => among.has(l[0])).map((l) => (
                                <LabelMark key={l[0]} l={l} perUnit={perUnit} on={sel === l[0]} />
                            ))}
                        </g>
                        {/* 真鍮の内側 2px の輪（形に沿わせる: 県の形で切り抜いた 4px の線の内側半分） */}
                        {foc && ids.has(foc) && (
                            <g aria-hidden="true">
                                <clipPath id={`${uid}clip`}><use href={`#${ids.get(foc)}`} /></clipPath>
                                <use href={`#${ids.get(foc)}`} className="jm-ring" clipPath={`url(#${uid}clip)`} style={{ strokeWidth: 4 }} />
                            </g>
                        )}
                    </svg>
                    {/* 拡大のボタンは左上（沖縄の枠は右下） */}
                    <div className="jm-zc" role="group" aria-label="地図の拡大">
                        <button type="button" className="jm-zb" aria-label="拡大" disabled={view.z >= ZOOM_MAX} onClick={() => zoomButton("in")}>＋</button>
                        <button type="button" className="jm-zb" aria-label="縮小" disabled={view.z <= ZOOM_MIN} onClick={() => zoomButton("out")}>－</button>
                        <button type="button" className="jm-zb" style={{ fontSize: 12 }} aria-label="全体に戻す" disabled={view.z <= ZOOM_MIN} onClick={() => zoomButton("reset")}>全体</button>
                    </div>
                    <div ref={tipRef} className="jm-tip" role="presentation" hidden={!hovName}>
                        {hovName && <><b className="font-semibold">{hovName}</b><span className="ml-1.5 text-text-2 tabular-nums">{counts.get(hov ?? "")}件</span></>}
                    </div>
                </div>

                {/* 一覧（スマホは地図の下に貼り付くシート・広い画面は右の札）。閉じているあいだ、スマホでは何も出さない */}
                <div
                    id={SHEET_ID}
                    ref={sheetRef}
                    tabIndex={-1}
                    role="region"
                    aria-label={selName ? `${selName}の撮影スポット` : "撮影スポットの一覧"}
                    data-open={sel ? "true" : "false"}
                    className="jm-sheet sm:mt-0 sm:sticky sm:top-20"
                    data-testid="home-japan-map-panel"
                >
                    {sel && selName ? (
                        <>
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "28px" }}>{selName}</h3>
                                    <p className="m-0 mt-0.5 text-text-2 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }}>撮影スポット {counts.get(sel)}件</p>
                                </div>
                                <button type="button" className="jm-close" aria-label="撮影スポットの一覧を閉じる" data-testid="home-japan-map-close" onClick={() => closeSheet(true)}>
                                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                                </button>
                            </div>
                            {selTops.length > 0 && (
                                <ul className="jm-spots m-0 mt-2 p-0 list-none" data-testid="home-japan-map-spots">
                                    {selTops.map((t) => (
                                        <li key={t[0]}>
                                            <TrackedLink href={`/spots/${t[0]}`} className="jm-spot" navArea="home_entry" navDest="map_spot" onClick={rememberMap}>
                                                <span className="min-w-0">
                                                    <span className="block truncate font-semibold text-white" style={{ fontSize: "15px", lineHeight: "20px" }}>{t[1]}</span>
                                                    {t[2] && <span className="block truncate text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>{t[2]}</span>}
                                                </span>
                                                <span aria-hidden="true" className="text-text-3">›</span>
                                            </TrackedLink>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <TrackedLink href={ROUTES.SPOT_AREA(sel)} className="jm-open" data-testid="home-japan-map-open" navArea="home_entry" navDest="map_pref" onClick={rememberMap}>
                                <span>{selName}の撮影スポットをすべて見る</span><span aria-hidden="true">›</span>
                            </TrackedLink>
                            <div className="jm-near">
                                <p className="m-0 mt-2.5 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>近くの県</p>
                                <div className="mt-1 flex flex-wrap gap-1.5">
                                    {selNear.map((s) => (
                                        <button key={s} type="button" className="jm-chip" onClick={() => press(s)}>{NAME.get(s)}</button>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <p className="m-0 text-text-3" style={{ fontSize: "13px", lineHeight: "18px" }}>県を押すと、名前と撮影スポットがここに出ます。</p>
                    )}
                </div>
                {/* 開閉を読み上げる（焦点は動かさない） */}
                <p className="sr-only" role="status" aria-live="polite" data-testid="home-japan-map-status">
                    {selName ? `${selName}の撮影スポット、上位${selTops.length}件を表示しました。` : ""}
                </p>

                <div className="sm:col-start-1">
                    <p className="m-0 mt-1 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>
                        小さな県は、地図の名前（線でつないだ字）を押してもえらべます。＋で拡大もできます。
                    </p>
                    <a href={`#${SPOT_LIST_ID}`} className="jm-link" data-testid="home-japan-map-textlink">すべての県を文字で見る ›</a>
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
        </section>
    );
}
