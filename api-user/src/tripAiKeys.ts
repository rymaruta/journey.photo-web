/**
 * AI の回数の行の鍵と、日・月の数え方（札 journey.photo-ios#621・#652）。
 * 退会の掃除（`account.ts`・user API）からも使うので、Bedrock を読み込む `tripAi.ts` と分けて置く。
 *
 *     `aiuse#<利用者>#<YYYY-MM>`   … その人のその月（日本時間）。欄は `aiQuota.ts` の先頭
 *     `aiuse#all#<YYYY-MM>`        … 全体のその月の推定金額（サーバーの AI の止め）
 *     `aiuse#all#<YYYY-MM-DD>`     … 全体のその日の推定金額と回数（記録）
 *
 * 利用者の ID は Cognito の sub（UUID）なので `all` とぶつからない。
 */

const JST = 9 * 3600_000;
const ym = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}`;

/** 日本時間の年月（`2026-11`） */
export function jstMonth(now: number): string {
    const d = new Date(now + JST);
    return ym(d.getUTCFullYear(), d.getUTCMonth());
}

/** 日本時間の年月日（`2026-11-20`） */
export function jstDate(now: number): string {
    const d = new Date(now + JST);
    return `${jstMonth(now)}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 日本時間の日（1〜31）と、その月の日数 */
export function jstDayOfMonth(now: number): { day: number; days: number } {
    const d = new Date(now + JST);
    return { day: d.getUTCDate(), days: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() };
}

/** 次に回数が戻る日（日本時間の翌月1日・`2026-12-01`） */
export function resetsOn(now: number): string {
    const d = new Date(now + JST);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return `${ym(t.getUTCFullYear(), t.getUTCMonth())}-01`;
}

export const aiUseKey = (uid: string, month: string) => `aiuse#${uid}#${month}`;
export const aiUseAllMonthKey = (month: string) => `aiuse#all#${month}`;
export const aiUseAllDayKey = (date: string) => `aiuse#all#${date}`;

/** 退会の掃除が消す鍵（この月から12か月前まで・13行） */
export function aiUseKeysForCleanup(uid: string, now: number): string[] {
    const d = new Date(now + JST);
    const out: string[] = [];
    for (let i = 0; i < 13; i++) {
        const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
        out.push(aiUseKey(uid, ym(t.getUTCFullYear(), t.getUTCMonth())));
    }
    return out;
}
