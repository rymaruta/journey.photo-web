// lib/data/spotVisitFactsCore.ts
//
// 型と純関数だけ（JSON を読まない）。画面の部品（クライアント）はここだけを読む——
// `spotVisitFacts.ts` は事実のファイル（約 230KB）を読み込むので、クライアントから読むと丸ごと配られる。
//
//
// **撮影スポットの「行く前に知りたい事実」**（見頃・アクセス・撮影の決まり・時間・料金）。
// 札 rymaruta/journey.photo-ios#527 の案 2（2026-11-11）。
//
// 置き場は `content/spot-visit-facts.json`（スラッグ → 事実）。台帳（`spots.json`）とは別のファイルにした:
//
//   - **事実の1行ごとに出典（URL・題・読んだ日）を持つ。** 台帳の `sources` は「項目ごとの出典」で、
//     しかも `checkedBy`（人の名前）が無いと数えない（`lib/utils/spotGuide.ts` の `sourcesFor`）。
//     ここに書くのは AI が公式サイト（施設・自治体・観光協会）の頁を読んで写した事実で、
//     人は開いていない——`checkedBy` に人の名前を書けば嘘になるので、台帳の `access`・`parking`・
//     `safetyNotes` には入れない（2026-11-11 判断）。画面は「AI 照合」と名乗る（台帳の `aiCheck` と同じ言い方）
//   - 1 回目は国内の 100 件。台帳の 4,000 行を書き換えずに足し引きできる
//
// 🔴 **出典の無い事実は描かない。** 読み込みの側で、URL（https）・題・読んだ日の揃わない行を落とす
// （`visitFactsFor`）。台帳の試験（`spotVisitFacts.test.ts`）は、そういう行がファイルに在るだけで落ちる。
// 三脚・自撮り棒・ドローンは、公式の頁に書いていなければ**書かない**（画面にもその道具の行を出さない。
// 読んだ頁に無いことは、サイト全体に無いことではない・確かめ役の指摘 2026-11-11）。
// 可否を推して埋めない。


/** 事実の出どころ。**読んだ頁の URL と、読んだ日** */
export type VisitFactSource = {
    /** 読んだ頁（https） */
    url: string;
    /** 頁の題（施設・自治体・観光協会の名前が分かるもの） */
    title: string;
    /** 読んだ日（ISO の日付） */
    readAt: string;
};

/** 事実の1行。**文と出典は対** */
export type VisitFactRow = VisitFactSource & {
    /** 画面に出す文（公式の頁の写しではなく、自分の言葉で短く） */
    text: string;
    /**
     * この日（ISO の日付）を過ぎたら出さない。**年の決まった事実だけ**に付ける
     * （「2026年の紅葉まつりは11月14日〜29日」など）。判定はビルドの日（`cleanVisitFacts` の `today`）
     */
    validUntil?: string;
};

/** 撮影の決まりの可否。**公式の頁に書いてあるときだけ** */
export type PhotoRuleStatus = "allowed" | "prohibited" | "conditional";

export type PhotoRule = VisitFactRow & { status: PhotoRuleStatus };

/** 開いている時間の1行。`opens`・`closes` は**毎日同じ時刻のときだけ**（構造化データに出す） */
export type VisitHoursRow = VisitFactRow & {
    /** "HH:MM"。季節・曜日で変わるなら書かない（文だけにする） */
    opens?: string;
    closes?: string;
};

export type SpotVisitFacts = {
    /** 調べを任せた人（owner）。**AI の名前は書かない** */
    delegatedBy: string;
    /** 読んだ頁の全部（事実の出典はこの中の頁でなければならない） */
    readPages: VisitFactSource[];
    /** 見頃（桜・紅葉・雪など、その場所に当てはまるものだけ） */
    bestSeasons?: Array<VisitFactRow & { subject: string }>;
    /** 行き方（最寄りの駅・バス停と歩く分数など） */
    access?: Array<VisitFactRow & { mode: "train" | "bus" | "car" | "walk" | "other" }>;
    /** 駐車場の有無 */
    parking?: VisitFactRow & { available: boolean };
    /** 開いている時間（拝観・開園・開館） */
    hours?: VisitHoursRow[];
    /** 拝観料・入場料 */
    fees?: VisitFactRow[];
    /** 撮影の決まり */
    photoRules?: {
        tripod?: PhotoRule;
        selfieStick?: PhotoRule;
        drone?: PhotoRule;
        /** 撮影禁止の範囲（本殿の中・館内など）や、撮影についてのそのほかの決まり */
        notes?: VisitFactRow[];
    };
};

export type FactsFile = { _about?: string; spots: Record<string, SpotVisitFacts> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 出典が揃っているか（https の URL・題・ISO の日付） */
export function hasSource(row: Partial<VisitFactSource> | null | undefined): row is VisitFactSource {
    return Boolean(row)
        && typeof row!.url === "string" && /^https:\/\/[^\s]+$/.test(row!.url)
        && typeof row!.title === "string" && row!.title.trim().length > 0
        && typeof row!.readAt === "string" && ISO_DATE.test(row!.readAt);
}

/** 今日（ISO の日付・UTC）。ビルドの日に決まる */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** 期限（`validUntil`）を過ぎた行か */
export const expired = (r: Partial<VisitFactRow> | null | undefined, today: string): boolean =>
    Boolean(r && typeof r.validUntil === "string" && r.validUntil < today);

const nonEmpty = <T,>(xs: T[] | undefined): T[] | undefined => (xs && xs.length > 0 ? xs : undefined);

/**
 * **出典の揃った行だけを残す。** 1行も残らなければ `null`（＝頁に段を出さない）。
 *
 * ファイルは試験が見張るが、ここでも落とす（二重の守り）——出典の無い事実が画面に出るのは、
 * 誰も気づかない壊れ方なので
 */
export function cleanVisitFacts(f: SpotVisitFacts | null | undefined, today: string = todayIso()): SpotVisitFacts | null {
    const okRow = <T extends Partial<VisitFactRow>>(r: T | null | undefined): r is T & VisitFactRow =>
        hasSource(r) && typeof r!.text === "string" && r!.text.trim().length > 0 && !expired(r, today);
    const okRule = (r: PhotoRule | undefined): PhotoRule | undefined =>
        okRow(r) && (r.status === "allowed" || r.status === "prohibited" || r.status === "conditional") ? r : undefined;
    if (!f || typeof f.delegatedBy !== "string" || !f.delegatedBy.trim()) return null;
    const rules = f.photoRules;
    const photoRules = rules ? {
        tripod: okRule(rules.tripod),
        selfieStick: okRule(rules.selfieStick),
        drone: okRule(rules.drone),
        notes: nonEmpty((rules.notes ?? []).filter(okRow)),
    } : undefined;
    const hasRules = Boolean(photoRules && (photoRules.tripod || photoRules.selfieStick || photoRules.drone || photoRules.notes));
    const out: SpotVisitFacts = {
        delegatedBy: f.delegatedBy,
        readPages: (f.readPages ?? []).filter(hasSource),
        bestSeasons: nonEmpty((f.bestSeasons ?? []).filter((r) => okRow(r) && Boolean(r.subject?.trim()))),
        access: nonEmpty((f.access ?? []).filter(okRow)),
        parking: okRow(f.parking) && typeof f.parking!.available === "boolean" ? f.parking : undefined,
        hours: nonEmpty((f.hours ?? []).filter(okRow)),
        fees: nonEmpty((f.fees ?? []).filter(okRow)),
        photoRules: hasRules ? JSON.parse(JSON.stringify(photoRules)) : undefined,
    };
    // 鍵ごと消す（`undefined` の鍵は RSC で "$undefined" として HTML に残る）
    for (const k of Object.keys(out) as (keyof SpotVisitFacts)[]) if (out[k] === undefined) delete out[k];
    const any = out.bestSeasons || out.access || out.parking || out.hours || out.fees || out.photoRules;
    return any ? out : null;
}

/**
 * 公式ではない頁（まとめ・口コミ・百科事典・地図・SNS）。**ここから読んだ事実は書かない**——
 * 他サイトの丸写しを防ぎ、出典を「施設・自治体・観光協会」に限る
 */
export const NOT_OFFICIAL_HOSTS = [
    "wikipedia.org", "minnacamera.com", "jalan.net", "tripadvisor", "google.", "goo.gl", "instagram.com",
    "facebook.com", "x.com", "twitter.com", "youtube.com", "tiktok.com", "ameblo.jp", "note.com", "retty.me",
    "tabelog.com", "rurubu", "jorudan", "navitime", "travel.rakuten", "asoview.com", "walkerplus.com", "4travel.jp",
    "tenki.jp", "yahoo.co.jp", "hotpepper.jp", "veltra.com", "klook.com", "mapple.net", "enjoytokyo.jp",
];

const AI_NAME_RE = /^(ai|claude|chatgpt|gpt(-?[\d.]+)?|copilot|assistant|llm|gemini|anthropic|openai|bot)$/i;

/**
 * ファイルの問題の一覧（**空なら良い**）。試験がこれを本物のファイルに掛ける。
 *
 * 出典（https の URL・題・読んだ日）の無い行・読んだ頁の一覧に無い URL・公式でない頁・未来の日付・
 * 委任者に AI の名前・中身の無い可否、を拾う。`today` は ISO の日付（読んだ日がそれより後なら落とす）
 */
export function visitFactProblems(file: FactsFile, today: string): string[] {
    const out: string[] = [];
    for (const [slug, f] of Object.entries(file.spots)) {
        if (!f.delegatedBy?.trim() || AI_NAME_RE.test(f.delegatedBy.trim())) out.push(`${slug}: delegatedBy が無いか AI の名前`);
        const read = new Set((f.readPages ?? []).map((p) => p.url));
        if (!read.size) out.push(`${slug}: readPages が空`);
        for (const p of f.readPages ?? []) if (!hasSource(p)) out.push(`${slug}: readPages に出典の欠けた頁 ${JSON.stringify(p)}`);
        const rows: Array<[string, Partial<VisitFactRow> | undefined]> = [
            ...(f.bestSeasons ?? []).map((r) => ["bestSeasons", r] as [string, VisitFactRow]),
            ...(f.access ?? []).map((r) => ["access", r] as [string, VisitFactRow]),
            ["parking", f.parking],
            ...(f.hours ?? []).map((r) => ["hours", r] as [string, VisitFactRow]),
            ...(f.fees ?? []).map((r) => ["fees", r] as [string, VisitFactRow]),
            ["tripod", f.photoRules?.tripod],
            ["selfieStick", f.photoRules?.selfieStick],
            ["drone", f.photoRules?.drone],
            ...(f.photoRules?.notes ?? []).map((r) => ["notes", r] as [string, VisitFactRow]),
        ];
        for (const [field, r] of rows) {
            if (r === undefined) continue;
            if (!hasSource(r)) { out.push(`${slug}.${field}: 出典（https の URL・題・読んだ日）が無い「${r?.text ?? ""}」`); continue; }
            if (!(r as Partial<VisitFactRow>).text?.trim()) out.push(`${slug}.${field}: 文が空`);
            if (r.readAt > today) out.push(`${slug}.${field}: 読んだ日が未来 ${r.readAt}`);
            const until = (r as Partial<VisitFactRow>).validUntil;
            if (until !== undefined && !ISO_DATE.test(until)) out.push(`${slug}.${field}: validUntil の形 ${until}`);
            if (!read.has(r.url)) out.push(`${slug}.${field}: readPages に無い頁 ${r.url}`);
            const host = new URL(r.url).host;
            if (NOT_OFFICIAL_HOSTS.some((h) => host.includes(h))) out.push(`${slug}.${field}: 公式でない頁 ${host}`);
        }
        for (const k of ["tripod", "selfieStick", "drone"] as const) {
            const st = f.photoRules?.[k]?.status;
            if (f.photoRules?.[k] && st !== "allowed" && st !== "prohibited" && st !== "conditional") out.push(`${slug}.${k}: 可否が無い`);
        }
        for (const h of f.hours ?? []) {
            if ((h.opens === undefined) !== (h.closes === undefined)) out.push(`${slug}.hours: opens と closes は対`);
            for (const t of [h.opens, h.closes]) if (t !== undefined && !HHMM.test(t)) out.push(`${slug}.hours: 時刻の形 ${t}`);
        }
        if (f.parking && typeof f.parking.available !== "boolean") out.push(`${slug}.parking: available が無い`);
        for (const r of f.bestSeasons ?? []) if (!r.subject?.trim()) out.push(`${slug}.bestSeasons: 何の見頃か（subject）が無い`);
    }
    return out;
}

/**
 * 画面に渡す形。**読んだ頁の一覧（`readPages`）と委任者は渡さない**——props は RSC として HTML に埋まり、
 * 読んだ頁の一覧は1件で10本近くある（画面は行ごとの出典だけを描く）
 */
export type SpotVisitFactsView = Omit<SpotVisitFacts, "readPages" | "delegatedBy">;

export function visitView(f: SpotVisitFacts): SpotVisitFactsView {
    const { readPages: _r, delegatedBy: _d, ...view } = f;
    void _r; void _d;
    return view;
}

/** 1つの段の出典（同じ頁は1回だけ） */
export function sourcesOf(rows: ReadonlyArray<VisitFactSource | undefined>): VisitFactSource[] {
    const seen = new Set<string>();
    const out: VisitFactSource[] = [];
    for (const r of rows) {
        if (!r || !hasSource(r) || seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({ url: r.url, title: r.title, readAt: r.readAt });
    }
    return out;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * 構造化データ（`TouristAttraction` に足す鍵）。**事実があるときだけ**鍵を出す。
 *
 * `openingHoursSpecification` は、毎日同じ時刻（`opens`・`closes` を書いた行）が**1行だけ**のとき。
 * 季節や曜日で変わる時間を1つの値に丸めると、検索に嘘を渡すことになる
 */
export function visitFactsStructuredData(f: SpotVisitFacts | null): Record<string, unknown> {
    if (!f) return {};
    const daily = (f.hours ?? []).filter((h) => h.opens && h.closes && HHMM.test(h.opens) && HHMM.test(h.closes));
    if (daily.length !== 1 || (f.hours ?? []).length !== 1) return {};
    return {
        openingHoursSpecification: [{
            "@type": "OpeningHoursSpecification",
            dayOfWeek: DAYS.map((d) => `https://schema.org/${d}`),
            opens: daily[0].opens,
            closes: daily[0].closes,
        }],
    };
}
