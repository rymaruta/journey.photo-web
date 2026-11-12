/**
 * 旅行プランへのお誘い（`/t`・2026-11-12）の1行。サーバーの `GET /trip-invites/{token}` が返す形。
 */
export type InviteTrip = { title: string; startDate?: string; endDate?: string; memberCount: number; spotCount: number };

const md = (iso: string) => {
    const [, m, d] = iso.split("-").map(Number);
    return `${m}月${d}日`;
};

/**
 * 「11月23日 〜 24日」「2人」「4か所」の並び。日付が無ければ人数と場所の数だけ。場所が0なら数を出さない。
 * **中黒で区切った1つの文字列にしない**（2026-11-12 の決まり）。画面が余白で分けて並べる（`/t` の頁）
 */
export function tripInviteParts(t: InviteTrip): string[] {
    const parts: string[] = [];
    if (t.startDate && t.endDate && t.startDate !== t.endDate) {
        const sameMonth = t.startDate.slice(0, 7) === t.endDate.slice(0, 7);
        parts.push(`${md(t.startDate)} 〜 ${sameMonth ? `${Number(t.endDate.slice(8))}日` : md(t.endDate)}`);
    } else if (t.startDate || t.endDate) {
        parts.push(md((t.startDate || t.endDate)!));
    }
    parts.push(`${t.memberCount}人`);
    if (t.spotCount > 0) parts.push(`${t.spotCount}か所`);
    return parts;
}
