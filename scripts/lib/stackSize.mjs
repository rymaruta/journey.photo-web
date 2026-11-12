/**
 * **CloudFormation のスタックの部品（リソース）の数を数えて、上限 500 に近づいたら止める**
 * （`scripts/check-stack-size.mjs`・札 journey.photo-ios#552 の①）。
 *
 * ## なぜ要るのか
 *
 * 2026-11-12、user API のスタック（`api-user/serverless.yml`）が 503 個になり、本番の
 * Deploy API Lambdas が `Number of resources, 503, is greater than maximum allowed, 500`
 * で落ちた（2026-10-09 にも 502 個で一度落ちている）。CloudFormation は**配る段になって
 * 初めて**断るので、PR の検査も staging も通ったまま本番で止まる。
 * 数は `serverless package` で作ったテンプレートの `Resources` を数えれば、AWS に触らずに分かる。
 *
 * ## 線
 *
 *  - **450 を超えたら失敗**（`FAIL_ABOVE`）。上限 500 まで 50 個の余裕を残す——
 *    関数1つで 3〜6 個（関数・ロググループ・経路・統合・権限…）増えるので、10 本ぶん弱
 *  - **400 を超えたら警告**（`WARN_ABOVE`）。止めないが、実行のまとめに出す
 *
 * ## 🔴 もう 450 を超えているスタックは「増やさない」で止める（`FROZEN_AT`）
 *
 * 入れた日（2026-11-12）の user API は **488 個**で、450 の線だけだと**今日から毎回止まり**、
 * 直しも本番に出せなくなる（減らすのは札 #552 の別の対応）。そこで、表に載せたスタックは
 * **載せた数より1つでも増えたら失敗**、同じか減ったなら通す（警告は出す）。
 * 減らしたら表の数も下げる（殻が「下げられる」と知らせる）。450 以下になったら表から外す。
 *
 * ここは**純粋な関数だけ**（`scripts/__tests__/stackSize.test.ts` が見張る）。
 * `serverless` を起こす・ファイルを読む・消すのは殻（`check-stack-size.mjs`）。
 */

/** CloudFormation の1スタックあたりの部品の上限 */
export const CFN_RESOURCE_LIMIT = 500;
/** これを**超えたら**失敗（450 ちょうどは通す） */
export const FAIL_ABOVE = 450;
/** これを**超えたら**警告 */
export const WARN_ABOVE = 400;

/**
 * **すでに 450 を超えているスタックの、増やしてよい上限**（ルートからの設定ファイルの道 → 数）。
 * ここに載っているものは「この数を超えたら失敗」。載っていないものは 450 を超えたら失敗。
 * **数を上げてはいけない**——上げるのは、上限 500 まで部品を足すのを認めることになる。
 */
export const FROZEN_AT = Object.freeze({
    // 2026-11-12 に数えた数（staging・prod とも 488）。分ける作業は札 journey.photo-ios#552
    "api-user/serverless.yml": 488,
});

/**
 * テンプレートの部品の数。`Resources` が無い・形が違うときは投げる
 * ——「0 個で通る」がいちばん悪い黙り方なので。
 * @param {unknown} template
 * @returns {number}
 */
export function countResources(template) {
    const res = template && typeof template === "object" ? template.Resources : undefined;
    if (!res || typeof res !== "object" || Array.isArray(res)) {
        throw new Error("テンプレートに Resources がありません（数えられない）");
    }
    return Object.keys(res).length;
}

/**
 * 種類（`AWS::Lambda::Function` など）ごとの数を多い順に。
 * @param {{Resources: Record<string, {Type?: string}>}} template
 * @param {number} [top] 上から何種類まで（省略で全部）
 * @returns {{type: string, count: number}[]}
 */
export function typeBreakdown(template, top) {
    countResources(template); // 形を確かめる
    const m = new Map();
    for (const r of Object.values(template.Resources)) {
        const t = (r && typeof r === "object" && r.Type) || "(種類なし)";
        m.set(t, (m.get(t) || 0) + 1);
    }
    const list = [...m.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
    return top === undefined ? list : list.slice(0, top);
}

/**
 * @param {number} count
 * @param {{failAbove?: number, warnAbove?: number, frozenAt?: number}} [opts]
 *   `frozenAt` は `FROZEN_AT` の数（そのスタックが載っているときだけ）
 * @returns {"ok"|"warn"|"frozen"|"fail"}
 *   `frozen` = 450 を超えているが、載せた数から増えていないので通す
 */
export function judge(count, { failAbove = FAIL_ABOVE, warnAbove = WARN_ABOVE, frozenAt } = {}) {
    if (!Number.isInteger(count) || count < 0) throw new Error(`部品の数が不正です: ${count}`);
    if (count > failAbove) {
        if (frozenAt === undefined) return "fail";
        // 載せた数そのものが上限を超えていたら、表が壊れている——通さない
        if (!Number.isInteger(frozenAt) || frozenAt >= CFN_RESOURCE_LIMIT) return "fail";
        return count > frozenAt ? "fail" : "frozen";
    }
    if (count > warnAbove) return "warn";
    return "ok";
}

/**
 * 設定の中で**既定値なし**で使われている `${param:名前}` の名前。
 * `package` はこれらが無いと変数を解決できずに落ちるので、殻が仮の値を渡す
 * （値は部品の数に効かない。`${param:x, ''}` のように既定値があるものは渡さない）。
 * @param {string} text
 * @returns {string[]}
 */
export function requiredParams(text) {
    const out = new Set();
    for (const m of text.matchAll(/\$\{param:([A-Za-z0-9_-]+)\s*\}/g)) out.add(m[1]);
    return [...out].sort();
}

/** 仮のアカウント ID（12 桁）。本物と取り違えないよう 0 だけ */
export const PLACEHOLDER_ACCOUNT_ID = "000000000000";

/**
 * `${aws:accountId}` を仮の 12 桁に置き換える。
 *
 * serverless v3 はこの変数を STS（`GetCallerIdentity`）に聞いて解決するので、
 * **AWS の鍵の無い PR の検査では `package` が落ちる**（実測: 鍵を外すと
 * 「AWS provider credentials not found」で変数を1つも解決できない）。
 * アカウント ID は ARN の文字に入るだけで部品の数を変えない
 * （本物の鍵で数えた数と同じになることを 2026-11-12 に確かめた: user API 488 = 488）。
 * @param {string} text
 */
export function substituteAccountId(text) {
    return text.replace(/\$\{aws:accountId\}/g, PLACEHOLDER_ACCOUNT_ID);
}

/**
 * 1 つのディレクトリの中の serverless の設定ファイル（`serverless.yml`・`serverless.<名前>.yml`）。
 * **新しい別スタック（例 `serverless.qr.yml`）を足したら、何もしなくても数える側に入る。**
 * 殻が作る仮の写し（`.stack-size-check-…`）は拾わない。
 * @param {string[]} names ディレクトリの中のファイル名
 * @returns {string[]}
 */
export function serverlessConfigNames(names) {
    return names.filter((n) => /^serverless(\.[A-Za-z0-9_-]+)?\.ya?ml$/.test(n)).sort();
}

/**
 * 結果の表（Markdown・実行のまとめ用）。
 * @param {{service: string, stage: string, count: number, level: string, top: {type: string, count: number}[]}[]} rows
 */
export function summaryMarkdown(rows) {
    const mark = { ok: "✅", warn: "⚠️", frozen: "⚠️ 増やせない", fail: "❌" };
    const lines = [
        `### CloudFormation の部品の数（上限 ${CFN_RESOURCE_LIMIT}・${FAIL_ABOVE} を超えたら失敗・${WARN_ABOVE} を超えたら警告）`,
        "",
        "| 設定 | stage | 数 | 判定 | 多い種類 |",
        "|---|---|---:|---|---|",
    ];
    for (const r of rows) {
        const top = r.top.map((t) => `${t.type.replace(/^AWS::/, "")} ${t.count}`).join("、");
        lines.push(`| ${r.service} | ${r.stage} | ${r.count} | ${mark[r.level] || r.level} | ${top} |`);
    }
    return lines.join("\n") + "\n";
}
