"use client";

// app/components/SpotPhotoParts.tsx
//
// **撮影スポットの写真の札に共通の部品**（2026-11-10・札 rymaruta/journey.photo-ios#516 の案A）。
// `/spots`（県・国・いまの季節の札）と県の頁（スポットの格子）が使う。
//
// - `SpotPhoto`: 写真。**読めなかったら呼び出し側へ知らせる**——札は「名前だけの札」に替える（壊れた画像の印を出さない）
// - `CreditMark`: 札の右上の「©」。頁の下の「写真の出典」の、その写真の項目へ移る
// - `PhotoCredits`: 頁の下の「写真の出典」。**畳まず常に出す**（2026-11-10 秘書室の判断。CC BY・CC BY-SA は
//   作者とライセンスの表示が条件で、どの写真の表示かが分かる形にする＝スポットの名前で並べる）

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import type { TopicCredit } from "@/lib/data/spotTopics";
import { useLocale } from "@/app/i18n/context";
import SectionHead from "./SectionHead";
import { TopicCreditLine } from "./SpotTopicLists";

/** 「写真の出典」の項目の `id`（札の © の行き先） */
export const photoCreditId = (key: string) => `photo-credit-${key}`;

/**
 * 写真（遅延読み込み・今ある小さい版）。`onFail` は読めなかったときに呼ぶ（`usePhotoFailed` の関数を渡す＝写真ごとに同じ関数）。
 *
 * 🔴 **代替文は空（飾り）。** 札のリンクは名前と件数を文字で持つので、写真の代替文を足すと読み上げが
 * 「阿寒湖 北海道 120」（北海道の札の写真が阿寒湖）や「阿寒湖 阿寒湖」になる（2026-11-10 確かめ役の指摘）。
 * 画像検索への影響（2026-11-10 事実）: 札の写真は小さい版（`/images/spots/thumb/…`）で、代替文は全 3,121 件が
 * スポットの名前そのもの（`topicCardCover` が `alt || name`）。スポットの頁の大きい写真（`/images/spots/…`）は
 * 代替文を持ったまま（例: `akanko.jpg` の `alt="阿寒湖"`）なので、落ちるのは小さい版の名前だけ
 *
 * 🔴 **水和の前に読み損ねた写真も拾う。** 静的 HTML の `<img>` は React が付く前に読み込みを始めるので、
 * そのあいだに失敗すると `onError` は届かない（React は付いたあとの出来事しか聞かない）。
 * 付いた時点で `complete`（読み終えたか壊れた）なのに `naturalWidth` が 0 なら、もう1回読んで確かめ、読めなければ失敗とする。
 * 遅延でまだ読みに行っていない写真は `complete` が偽なので、ここでは拾わない（あとで `onError` が来る）
 * ——2026-11-10 実測（`next build` の書き出し・Playwright の Chromium と WebKit・電話 390 と PC 1280・/spots と北海道）:
 * まだ読んでいない写真は両方とも `complete` が偽（例: WebKit の電話の /spots で 40 枚すべて）、確かめの読み直しは 0 回
 * （開いて 3 秒で読みに行った写真は、電話の /spots で Chromium 66/66・WebKit 26/66。同じ写真を2回読んだものは無い）
 */
export function SpotPhoto({ src, onFail, className = "absolute inset-0 w-full h-full object-cover" }: {
    src: string; onFail: () => void; className?: string;
}) {
    const ref = useRef<HTMLImageElement>(null);
    useEffect(() => {
        const img = ref.current;
        if (!img || !img.complete || img.naturalWidth !== 0) return;
        // 壊れて見えるときだけ、同じ場所をもう1回読んで確かめる（読めたら札はそのまま）。
        // 「付いた時点で complete かつ幅 0」だけで決めないのは、試験の DOM（happy-dom）が読み込まない写真を
        // 最初からその形で返すため——本物のブラウザでも、確かめてから替える方が取り違えが無い
        let alive = true;
        const probe = new Image();
        probe.onerror = () => { if (alive) onFail(); };
        probe.src = img.currentSrc || img.src;
        return () => { alive = false; probe.onerror = null; };
    }, [src, onFail]);
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src={src} alt="" loading="lazy" decoding="async" onError={onFail}
             className={className} data-testid="spot-photo" />
    );
}

/** 写真が読めなかったか（`SpotPhoto` の `onFail` で立てる）。src が変われば戻す */
export function usePhotoFailed(src: string | undefined): [boolean, () => void] {
    const [failed, setFailed] = React.useState<string | null>(null);
    // 同じ写真のあいだは同じ関数（`SpotPhoto` の確かめを描くたびにやり直さない）
    const fail = React.useCallback(() => { if (src) setFailed(src); }, [src]);
    return [!!src && failed === src, fail];
}

/**
 * 札の右上の「©」（写真の上なので白・ガラスの丸 24px・当たり 44）。札のリンクの**外**に置く
 * （リンクの中にリンクを入れない）。押すと頁の下の、その写真の出典の項目へ移る。
 * 読み上げは**写っているスポットの名前**（`name`）。県・国の札では札の名前（`place`）を括弧で添える
 * （「写真の出典: 阿寒湖（北海道）」・2026-11-10 確かめ役の指摘。写真は飾りなので、何の写真かはここでしか言えない）
 */
export function CreditMark({ creditKey, name, place }: { creditKey: string; name: string; place?: string }) {
    const { locale } = useLocale();
    const en = locale === "en";
    const what = place ? (en ? `${name} (${place})` : `${name}（${place}）`) : name;
    return (
        <Link href={`#${photoCreditId(creditKey)}`} prefetch={false}
           aria-label={en ? `Photo credit: ${what}` : `写真の出典: ${what}`}
           data-testid="credit-mark"
           className="absolute top-0 right-0 z-10 flex items-center justify-center w-11 h-11 rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white">
            <span aria-hidden="true"
                  className="flex items-center justify-center w-6 h-6 rounded-full text-white ring-1 ring-inset ring-line"
                  style={{ fontSize: "12px", lineHeight: "12px", background: "rgba(0,0,0,.55)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>
                ©
            </span>
        </Link>
    );
}

export type PhotoCreditItem = { key: string; name: string; credit: TopicCredit };

/**
 * **頁の下の「写真の出典」**（畳まない）。1項目＝スポットの名前＋作者・ライセンス（文面へ）・出典（Commons へ）。
 * 項目の `id` が札の © の行き先（`<Link>` の移動は `:target` を立てないので、行き先の縁取りはしない）
 */
export function PhotoCredits({ items }: { items: PhotoCreditItem[] }) {
    const { locale } = useLocale();
    const en = locale === "en";
    if (items.length === 0) return null;
    return (
        <section className="mt-10 mb-7" aria-labelledby="photo-credits" data-testid="photo-credits">
            <SectionHead id="photo-credits" eyebrow="CREDITS"
                title={<>{en ? "Photo credits" : "写真の出典"}
                    <span aria-hidden="true" className="ml-2 align-baseline font-sans font-normal tabular-nums text-text-2" style={{ fontSize: "13px" }}>
                        {en ? `${items.length}` : `${items.length}枚`}
                    </span></>} />
            <p className="m-0 mb-3 text-text-3" style={{ fontSize: "12px", lineHeight: "18px" }}>
                {en
                    ? "Photo authors and licenses, by place. The © on a photo leads here."
                    // 画面の文に内部の呼び名（「札」）を出さない（2026-11-10 確かめ役の指摘）
                    : "写真の作者とライセンスです。写真の右上の © から、その写真の項目に移れます。"}
            </p>
            <ol className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 m-0 p-0" style={{ listStyle: "none" }}>
                {items.map((c) => (
                    <li key={c.key} id={photoCreditId(c.key)} data-testid="photo-credit-item"
                        className="scroll-mt-24 py-1.5 border-b border-line">
                        {/* 1項目を1段落に（2026-11-10 実測: 名前と表示を2段にすると /spots の電話で一覧が 3,668px になった） */}
                        <p className="m-0 text-white/60 wrap-anywhere" style={{ fontSize: "12px", lineHeight: "18px" }}>
                            <span className="text-white font-semibold" style={{ fontSize: "13px" }}>{c.name}</span>
                            {"　"}
                            <TopicCreditLine credit={c.credit} inline />
                        </p>
                    </li>
                ))}
            </ol>
        </section>
    );
}
