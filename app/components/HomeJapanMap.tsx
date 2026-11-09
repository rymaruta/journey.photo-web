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
// 作り（提案書のとおり）:
//   - 各県は本物のリンク（行き先は県の頁・`ROUTES.SPOT_AREA`）。**押した県が 44px 以上なら直接移動**、
//     それより小さい県は札（名前・件数・近くの県3つ・「見る」）を出す。当たりは見えない太い線（halo 10px）で太らせ、
//     海のタップは 14px 以内でいちばん近い県へ寄せる
//   - 拡大: ＋ − 全体（**左上**・沖縄の枠を覆わない）・ダブルクリック・Ctrl+ホイール・ドラッグ・ピンチ
//   - キーボード: Tab で地図に入ると止まり先は1か所（北海道）・矢印キーで隣の県・Enter で移動・Esc で札を閉じる。
//     先頭に「地図を飛ばして文字の一覧へ」。県ごとに名前付きのリンク（読み上げは「神奈川県の撮影スポット、63件」）。
//     フォーカスの輪は真鍮の内側 2px（形に沿う）
//   - 色だけに頼らない: 選んだ県は縁も太くなる。件数の濃淡は**初期オフ**（チェックで切り替え・凡例つき）
//   - 沖縄は枠に入れて右下へ・縮尺は本土と同じ（枠の字は「沖縄県」だけ。長いと島に重なる）。海外は今の国の一覧のまま（世界地図は別案）
// 高さ: スマホで画面の 6 割まで（`globals.css` の `jm-wrap`）。**縦のスクロールを奪わない**ため、拡大していないあいだは
// `touch-action: pan-y`。拡大中だけ `none`（そうしないと拡大した地図を縦に動かせない）。
//
// 計測: 県の頁へ**移動する押し方**（直接移動・キーボード・新しいタブ・札の「見る」）だけ `nav_click`
// （`area: home_entry` / `dest: map_pref`）。札を出すだけの押下・拡大・濃淡は数えない。県の名前・URL は送らない。

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { HomeAreaRow } from "@/lib/data/homeSpotEntry";
import { PREFECTURES } from "@/lib/data/prefectures";
import { MAP_H, MAP_W, OKINAWA_FRAME, PREFECTURE_SHAPES } from "@/lib/data/prefectureShapes";
import {
    NEAR_TAP_PX, ZOOM_MAX, ZOOM_MIN, clampView, densityBin, densityCuts, isDirectTap, nearestByBox,
    nearestSlugs, neighborInDirection, shapeOf, type MapView,
} from "@/lib/utils/japanMap";
import { ROUTES } from "@/lib/routes";
import SectionHead from "./SectionHead";
import TrackedLink from "./TrackedLink";
import { track } from "@/lib/utils/analytics";

const HEADING_ID = "home-japan-map-h";
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

export default function HomeJapanMap({ areas }: { areas: readonly HomeAreaRow[] }) {
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

    const select = useCallback((slug: string | null) => {
        setSel(slug);
        if (slug) reveal(slug);
    }, [reveal]);

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
        // 新しいタブへ・キーボード（Enter は detail 0・指のずれの心配が無い）・読み上げの操作は、いつも直接移動
        const slug = e.currentTarget.getAttribute("data-s");
        if (!slug) return;
        const goes = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0 || e.detail === 0
            || isDirectTap(slug, pxRef.current * viewRef.current.z);
        if (goes) {
            // 移動する押し方だけ数える（札を出すだけの押下は数えない）。県の名前・URL は送らない
            track("nav_click", { area: "home_entry", dest: "map_pref" });
            return;
        }
        e.preventDefault();
        select(slug);
    }, [select]);

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
        if (h) { select(h); return; }
        const [x, y] = toMap(e.clientX, e.clientY);
        const near = nearestByBox(x, y, NEAR_TAP_PX / (pxRef.current * viewRef.current.z), among);
        if (near) select(near);
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
        select(slug);
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
        } else if (e.key === "Escape") {
            setSel(null);
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
    const legend = [
        `〜${cuts[0]}件`, `${cuts[0] + 1}〜${cuts[1]}件`, `${cuts[1] + 1}〜${cuts[2]}件`, `${cuts[2] + 1}件〜`,
    ];
    const LEGEND_FILL = ["#1e1a12", "#3b301d", "#6b5937", "#a8864f"];

    return (
        <section aria-labelledby={HEADING_ID} className="pt-2 pb-6 text-white" data-testid="home-japan-map">
            <SectionHead id={HEADING_ID} eyebrow="PHOTO SPOTS" title="撮影スポットを地図から探す" className="mb-0" testId="home-japan-map-head" />
            <p className="m-0 mt-2 text-text-2" style={{ fontSize: "13px", lineHeight: "18px" }}>
                県を選ぶと、その県の撮影スポットの一覧へ移動します。数字は掲載している件数です。
            </p>
            <a href={`#${SPOT_LIST_ID}`} className="sr-only focus:not-sr-only focus:inline-flex focus:items-center focus:min-h-[44px] focus:text-text-2 focus:underline focus:underline-offset-4 jm-skip" data-testid="home-japan-map-skip">
                地図を飛ばして文字の一覧へ
            </a>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-[minmax(0,420px)_minmax(0,1fr)] sm:gap-x-7 sm:items-start">
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
                        aria-label="日本の地図。県を選ぶと、その県の撮影スポットの一覧へ移動します。同じ内容の文字の一覧はページの下にあります。"
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
                                    tabIndex={rove === null ? undefined : rove === s[0] ? 0 : -1}
                                    onClick={onLinkClick}
                                >
                                    {s[0] === "okinawa" && <rect className="jm-hit" x={fx} y={fy} width={fw} height={fh} />}
                                    <use href={`#${ids.get(s[0])}`} className="jm-hit" />
                                </Link>
                            ))}
                        </g>
                        {/* 拡大中の県名（画面で 30px 以上に見える県だけ・字は常に 12px） */}
                        {zoomed && (
                            <g aria-hidden="true">
                                {PREFECTURE_SHAPES.filter((s) => s[0] === "okinawa" || Math.min(s[2][2], s[2][3]) * perUnit >= 30).map((s) => {
                                    const nm = NAME.get(s[0]) ?? "";
                                    return (
                                        <text key={s[0]} className="jm-name" x={s[3][0]} y={s[3][1]} textAnchor="middle"
                                            style={{ fontSize: 12 / perUnit, strokeWidth: 3 / perUnit }}>
                                            {s[0] === "hokkaido" ? nm : nm.replace(/[県府都]$/, "")}
                                        </text>
                                    );
                                })}
                            </g>
                        )}
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

                <div className="mt-2.5 sm:mt-0 sm:sticky sm:top-20 rounded-2xl bg-surface px-4 py-3.5 min-h-[132px]" style={{ boxShadow: "inset 0 0 0 1px var(--color-line)" }} data-testid="home-japan-map-panel">
                    {sel && selName ? (
                        <>
                            <h3 className="m-0 font-serif font-bold text-white" style={{ fontSize: "22px", lineHeight: "28px" }}>{selName}</h3>
                            <p className="m-0 mt-0.5 text-text-2 tabular-nums" style={{ fontSize: "13px", lineHeight: "18px" }}>撮影スポット {counts.get(sel)}件</p>
                            <TrackedLink href={ROUTES.SPOT_AREA(sel)} className="jm-open" data-testid="home-japan-map-open" navArea="home_entry" navDest="map_pref">
                                <span>{selName}の撮影スポットを見る</span><span aria-hidden="true">›</span>
                            </TrackedLink>
                            <p className="m-0 mt-2.5 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>近くの県</p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {selNear.map((s) => (
                                    <button key={s} type="button" className="jm-chip" onClick={() => select(s)}>{NAME.get(s)}</button>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="m-0 text-text-3" style={{ fontSize: "13px", lineHeight: "18px" }}>県を選ぶと、名前と撮影スポットの件数がここに出ます。</p>
                    )}
                </div>

                <div className="sm:col-start-1">
                    <p className="m-0 mt-1 text-text-3" style={{ fontSize: "12px", lineHeight: "16px" }}>
                        小さな県は、押すと札が出ます。＋で拡大もできます。
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
