// app/components/SpotVisitFacts.tsx
//
// **撮影スポットの頁の「行く前に知りたい事実」の段**（札 rymaruta/journey.photo-ios#527 の案 2・2026-11-11）。
// 見頃・アクセス・開いている時間と料金・撮影の決まり。データは `lib/data/spotVisitFacts.ts`。
//
// - どの段も、**出典の揃った行が1つも無ければ出さない**（`cleanVisitFacts` が落とした後の値を受ける）
// - 段ごとに出典の行を付ける。「（AI 照合 日付）」と名乗る——人が確かめたとは書かない
//   （台帳の `aiCheck` の出典の行と同じ言い方・`SpotGuideClient`）
// - 見た目は撮影スポットの頁の既存の段（アクセスの `dl`・撮影時の注意の札）と同じ字・色・余白
import React from "react";
import type { SpotVisitFactsView as SpotVisitFacts, VisitFactSource, PhotoRule } from "@/lib/data/spotVisitFactsCore";
import { sourcesOf } from "@/lib/data/spotVisitFactsCore";

const LABEL = { fontSize: "12px" } as const;
const BODY = { fontSize: "13px", lineHeight: "20px" } as const;

/** 段の出典（同じ頁は1回）。**変わることがあるので、行く前に公式で確かめて**と添える */
export function VisitSources({ rows, isJa, testId }: { rows: ReadonlyArray<VisitFactSource | undefined>; isJa: boolean; testId?: string }) {
    const list = sourcesOf(rows);
    if (!list.length) return null;
    return (
        <p className="m-0 mt-2 text-white/50" style={{ fontSize: "12px", lineHeight: "17px" }} data-testid={testId}>
            {isJa ? "出典: " : "Source: "}
            {list.map((s, i) => (
                <React.Fragment key={s.url}>
                    {i > 0 && " / "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                       className="underline decoration-white/30 underline-offset-2 hover:text-white/80">
                        {s.title}
                    </a>
                    <span>{isJa ? `（AI 照合 ${s.readAt}）` : ` (checked by AI, ${s.readAt})`}</span>
                </React.Fragment>
            ))}
        </p>
    );
}

const MODE_JA = { train: "電車", bus: "バス", car: "車", walk: "徒歩", other: "そのほか" } as const;
const MODE_EN = { train: "Train", bus: "Bus", car: "By car", walk: "On foot", other: "Other" } as const;

/** アクセスの段の中身（行き方・駐車場）。段の枠と見出しは `SpotGuideClient` の「アクセス」 */
export function VisitAccessRows({ facts, isJa }: { facts: SpotVisitFacts; isJa: boolean }) {
    const access = facts.access ?? [];
    const parking = facts.parking;
    if (!access.length && !parking) return null;
    return (
        <div data-testid="spot-visit-access">
            {access.length > 0 && (
                <dl className="m-0">
                    {access.map((a) => (
                        <React.Fragment key={`${a.mode}-${a.text}`}>
                            <dt className="text-white/55" style={LABEL}>{(isJa ? MODE_JA : MODE_EN)[a.mode] ?? a.mode}</dt>
                            <dd className="m-0 mb-2 text-white/85" style={BODY}>{a.text}</dd>
                        </React.Fragment>
                    ))}
                </dl>
            )}
            {parking && (
                <div className={access.length ? "mt-1" : ""}>
                    <p className="m-0 text-white/55" style={LABEL}>{isJa ? "駐車場" : "Parking"}</p>
                    <p className="m-0 text-white/85" style={BODY}>{parking.text}</p>
                </div>
            )}
            <VisitSources rows={[...access, parking]} isJa={isJa} testId="spot-visit-access-sources" />
        </div>
    );
}

/** 開いている時間と料金（アクセスの下・右の列） */
export function VisitHoursFees({ facts, isJa, head }: { facts: SpotVisitFacts; isJa: boolean; head: (id: string, title: string) => React.ReactNode }) {
    const hours = facts.hours ?? [];
    const fees = facts.fees ?? [];
    if (!hours.length && !fees.length) return null;
    return (
        <section className="mb-7" aria-labelledby="spot-hours" data-testid="spot-hours">
            {head("spot-hours", isJa ? "開いている時間と料金" : "Hours and admission")}
            <dl className="m-0">
                {hours.length > 0 && (
                    <>
                        <dt className="text-white/55" style={LABEL}>{isJa ? "時間" : "Hours"}</dt>
                        {hours.map((h) => <dd key={h.text} className="m-0 mb-2 text-white/85" style={BODY}>{h.text}</dd>)}
                    </>
                )}
                {fees.length > 0 && (
                    <>
                        <dt className="text-white/55" style={LABEL}>{isJa ? "料金" : "Admission"}</dt>
                        {fees.map((f) => <dd key={f.text} className="m-0 mb-2 text-white/85" style={BODY}>{f.text}</dd>)}
                    </>
                )}
            </dl>
            <VisitSources rows={[...hours, ...fees]} isJa={isJa} testId="spot-hours-sources" />
        </section>
    );
}

/** 見頃（季節の見どころの事実）。撮影ガイドの前 */
export function VisitSeasons({ facts, isJa, head }: { facts: SpotVisitFacts; isJa: boolean; head: (id: string, title: string) => React.ReactNode }) {
    const rows = facts.bestSeasons ?? [];
    if (!rows.length) return null;
    return (
        <section className="pt-8" aria-labelledby="spot-best-season" data-testid="spot-best-season">
            {head("spot-best-season", isJa ? "見頃" : "Best time to visit")}
            <ul className="m-0 p-0 flex flex-col gap-2" style={{ listStyle: "none" }}>
                {rows.map((r) => (
                    <li key={`${r.subject}-${r.text}`} className="flex gap-2.5">
                        <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-chip text-chip-text"
                              style={{ fontSize: "12px", padding: "2px 10px", height: "22px" }}>
                            {r.subject}
                        </span>
                        <span className="text-white/85" style={{ fontSize: "15px", lineHeight: "24px" }}>{r.text}</span>
                    </li>
                ))}
            </ul>
            <VisitSources rows={rows} isJa={isJa} testId="spot-best-season-sources" />
        </section>
    );
}

const STATUS_JA = { allowed: "可", prohibited: "不可", conditional: "条件つき" } as const;
const STATUS_EN = { allowed: "Allowed", prohibited: "Not allowed", conditional: "With conditions" } as const;

/**
 * 撮影の決まり（三脚・自撮り棒・ドローン・撮影禁止の範囲）。
 *
 * 三つの道具のうち、公式の頁に書いていないものは「公式サイトに記載なし」——**可否を推して書かない**。
 * ドローンには、法律の決まりがあるという一般の注意を必ず添える（公式に書いてあってもなくても）
 */
export function VisitPhotoRules({ facts, isJa, head }: { facts: SpotVisitFacts; isJa: boolean; head: (id: string, title: string) => React.ReactNode }) {
    const r = facts.photoRules;
    if (!r) return null;
    const items: Array<[string, string, PhotoRule | undefined]> = [
        ["tripod", isJa ? "三脚" : "Tripods", r.tripod],
        ["selfieStick", isJa ? "自撮り棒" : "Selfie sticks", r.selfieStick],
        ["drone", isJa ? "ドローン" : "Drones", r.drone],
    ];
    const notes = r.notes ?? [];
    return (
        <section className="pt-8" aria-labelledby="spot-photo-rules" data-testid="spot-photo-rules">
            {head("spot-photo-rules", isJa ? "撮影の決まり" : "Photography rules")}
            <div className="rounded-xl bg-surface ring-1 ring-line p-3.5">
                <dl className="m-0 flex flex-col gap-1.5">
                    {items.map(([key, label, rule]) => (
                        <div key={key} className="flex gap-3" data-testid={`photo-rule-${key}`}>
                            <dt className="flex-shrink-0 w-[4.5rem] text-white/55" style={BODY}>{label}</dt>
                            <dd className="m-0 text-white/85" style={BODY}>
                                {rule
                                    ? <><span className="text-white font-semibold">{(isJa ? STATUS_JA : STATUS_EN)[rule.status]}</span>{"　"}{rule.text}</>
                                    : <span className="text-white/55">{isJa ? "公式サイトに記載なし" : "Not stated on the official site"}</span>}
                            </dd>
                        </div>
                    ))}
                </dl>
                {notes.length > 0 && (
                    <ul className="m-0 mt-2.5 p-0 flex flex-col gap-1" style={{ listStyle: "none" }}>
                        {notes.map((n) => (
                            <li key={n.text} className="text-white/85" style={BODY}>・{n.text}</li>
                        ))}
                    </ul>
                )}
                <p className="m-0 mt-2.5 text-white/55" style={{ fontSize: "12px", lineHeight: "17px" }} data-testid="photo-rule-drone-law">
                    {isJa
                        ? "ドローンは、施設の決まりとは別に、航空法と小型無人機等飛行禁止法の決まりがあります。"
                        : "Apart from the site's own rules, drones are regulated in Japan by the Civil Aeronautics Act and the Small Unmanned Aircraft Flight Prohibition Act."}
                </p>
                <VisitSources rows={[r.tripod, r.selfieStick, r.drone, ...notes]} isJa={isJa} testId="spot-photo-rules-sources" />
            </div>
        </section>
    );
}
