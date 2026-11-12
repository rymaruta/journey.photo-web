import { TAG_CHOICES } from "./tagChoices";
import { groupKey, postedAt } from "./homeFeed";

/**
 * **今週のお題**（iOS の `WeeklyTheme.swift` の写し・札 journey.photo-ios#537 案2・2026-11-11。前は日替わりの「今日のテーマ」）。
 *
 * 🔴 なぜ週替わりに: 日替わりの 7 つのテーマに付いた公開の写真は**0 枚**だった（2026-11-11 に `photos.json` で数えた）。
 * 載せる人が数人の今は、1 日では誰も間に合わない。1 週間あれば数人が同じお題で載せられ、みんなの参加が札に並ぶ。
 *
 * **季節×撮影スポット。** お題は季節（その週の月曜の月）ごとの一覧から回す。季節の代表のお題（桜・海・紅葉・雪）は
 * その季節の撮影スポットへ誘う言い方にしてある。
 *
 * **サーバーは何も持っていない。** お題は日付から決まる。「参加する」はそのタグを入れた投稿画面を開くだけ。
 * 参加した数は**公開の写真のタグと投稿日で数える**（`themeParticipants`）。同じお題に誰かが載せたときの知らせは
 * 作っていない（サーバーの変更が要る・札 #537 に報告）。
 *
 * ⚠️ **一覧・順番・週の区切りは iOS と同じにする。** ずれるとアプリと Web で今週のお題が割れる
 * （`weeklyTheme.test.ts` と iOS の `WeeklyThemeTests` が同じ日付と答えで縛る）。
 */
export type WeeklyThemeEntry = {
    /** 投稿に入れるタグ（`TAG_CHOICES` の中から） */
    tag: string;
    title: { ja: string; en: string };
    prompt: { ja: string; en: string };
};

type Season = "spring" | "summer" | "autumn" | "winter";

const t = (tag: string, titleJa: string, titleEn: string, promptJa: string, promptEn: string): WeeklyThemeEntry =>
    ({ tag, title: { ja: titleJa, en: titleEn }, prompt: { ja: promptJa, en: promptEn } });

/** 季節ごとのお題。**隣り合う季節で同じタグを使わない**（季節の変わり目で同じお題が 2 週続かない）。順番に意味はある */
export const THEMES_BY_SEASON: Readonly<Record<Season, readonly WeeklyThemeEntry[]>> = {
    spring: [
        t("桜", "桜のころ", "Cherry blossom season", "桜の観光スポットで、咲いている今を。", "Catch the blossoms at a photo spot."),
        t("花", "足もとの色", "Color underfoot", "小さくても、目を引いた色を。", "Small things that caught your eye."),
        t("朝", "朝のはじまり", "First light", "一日の最初の色を撮ってみませんか。", "Catch the day's first color."),
        t("公園", "近くの公園", "The park nearby", "いつもの公園の、今週の景色を。", "This week's view of a park you know."),
        t("川", "川のある景色", "Along the river", "流れのそばで見つけた一枚を。", "A frame found by the water's flow."),
    ],
    summer: [
        t("海", "水のある風景", "By the water", "海辺の観光スポットで、水のある一枚を。", "A shot by the sea at a photo spot."),
        t("空", "夏の空", "Summer sky", "見上げた空の色を。", "The color of the sky above you."),
        t("夜", "夜のあかり", "Night lights", "暗くなってから見えてくるものを。", "What only appears after dark."),
        t("雨", "雨の日の景色", "Rainy days", "雨の日にしか撮れない一枚を。", "A shot only a rainy day can give."),
        t("山", "山と空", "Mountains and sky", "雄大な自然がつくる、心を動かす風景を。", "Landscapes that move you."),
    ],
    autumn: [
        t("夕焼け", "光と影", "Light and shadow", "光がつくる特別な瞬間を見つけよう。", "Find a moment shaped by light."),
        t("紅葉", "色づく景色", "Autumn colors", "紅葉の観光スポットで、今だけの色を。", "Autumn colors at a photo spot, only now."),
        t("神社", "その土地の場所", "Places of the land", "その土地にしかない場所を訪ねて。", "Somewhere only there."),
        t("森", "森を歩く", "Into the woods", "木々のあいだの光と影を。", "Light and shade between the trees."),
        t("湖", "湖のほとり", "By the lake", "静かな水面に映るものを。", "What the still water reflects."),
    ],
    winter: [
        t("雪", "雪の景色", "Snowscapes", "雪の観光スポットで、白い一枚を。", "A white frame at a snowy photo spot."),
        t("冬", "冬の光", "Winter light", "低い日差しがつくる、冬だけの色を。", "Colors only the low winter sun makes."),
        t("夜", "冬のあかり", "Winter lights", "暗くなってから見えてくるものを。", "What only appears after dark."),
        t("山", "冬の山", "Winter mountains", "澄んだ空気の中の山を。", "Mountains in the clear winter air."),
    ],
};

export const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** 西暦1年1月1日を1とした、1970-01-01（木）の通し日数（iOS の `WeeklyTheme.epochOrdinal`） */
const EPOCH_ORDINAL = 719163;
/** 週の区切りの月曜（1970-01-05）の通し日数。**週は月曜から** */
const MONDAY_ORDINAL = 719167;
const DAY_MS = 86_400_000;

/**
 * 🔴 **週の区切りは日本の時刻（Asia/Tokyo）に固定**（札 journey.photo-ios#537 の確かめ役・2026-11-11。今日の一問の
 * `QUIZ_TIME_ZONE` と同じ考え・iOS の `WeeklyTheme.calendar` と同じ）。端末の時刻帯で区切ると、海外の人だけ
 * 月曜の朝 9 時まで先週のお題になり、「今週の参加」の範囲も人によってずれる。
 * 日本には夏時間が無いので、協定世界時に 9 時間足した暦の年月日が日本の年月日
 */
const TOKYO_OFFSET_MS = 9 * 3_600_000;

/** 日本の暦の今日の通し日数（年月日を協定世界時の正午に置いて数える・iOS と同じ） */
function dayOrdinal(now: Date): number {
    const tokyo = new Date(now.getTime() + TOKYO_OFFSET_MS);
    return Math.floor(Date.UTC(tokyo.getUTCFullYear(), tokyo.getUTCMonth(), tokyo.getUTCDate(), 12) / DAY_MS) + EPOCH_ORDINAL;
}

/** 週の通し番号（1970-01-05 の週が 0）。月曜の 0 時（日本の時刻）で替わる */
export function weekIndex(now: Date = new Date()): number {
    return Math.floor((dayOrdinal(now) - MONDAY_ORDINAL) / 7);
}

/** その週の月曜の年月日（西暦。月は 1〜12） */
function mondayOf(week: number): { y: number; m: number; d: number } {
    const at = new Date((MONDAY_ORDINAL + week * 7 - EPOCH_ORDINAL) * DAY_MS + 12 * 3_600_000);
    return { y: at.getUTCFullYear(), m: at.getUTCMonth() + 1, d: at.getUTCDate() };
}

/** 月から季節（春 3〜5 月・夏 6〜8 月・秋 9〜11 月・冬 12〜2 月。iOS の `SpotBodyText.season(ofMonth:)`） */
function seasonOfMonth(month: number): Season {
    if (month >= 3 && month <= 5) return "spring";
    if (month >= 6 && month <= 8) return "summer";
    if (month >= 9 && month <= 11) return "autumn";
    return "winter";
}

/** その週のお題。**季節はその週の月曜の月で決める**（週の途中で月が替わってもお題は替わらない） */
export function themeOfWeek(week: number): WeeklyThemeEntry {
    const themes = THEMES_BY_SEASON[seasonOfMonth(mondayOf(week).m)];
    return themes[((week % themes.length) + themes.length) % themes.length];
}

/** 今週のお題（日本の時刻の週） */
export function weeklyThemeFor(now: Date = new Date()): WeeklyThemeEntry {
    return themeOfWeek(weekIndex(now));
}

/** 今週（日本の時刻の月曜 0 時〜次の月曜 0 時）。ミリ秒の [start, end) */
export function weekRange(now: Date = new Date()): { start: number; end: number } {
    const { y, m, d } = mondayOf(weekIndex(now));
    const start = Date.UTC(y, m - 1, d) - TOKYO_OFFSET_MS;
    return { start, end: start + 7 * DAY_MS };
}

/** 全部のお題のタグ（季節の順・重なりは除く） */
export const THEME_TAGS: readonly string[] = [...new Set(SEASONS.flatMap((s) => THEMES_BY_SEASON[s].map((e) => e.tag)))];

/**
 * 投稿画面の `?tag=` を読む。**お題のタグだけを受け取る**——任意の語を URL から
 * 入れられると、リンク 1 本で人の投稿に知らない語を混ぜられる。
 * 週をまたいで開いたリンク（先週のお題）でも、お題の一覧にあるタグなら受ける
 */
export function readThemeTag(raw: string | null | undefined): string | null {
    if (!raw) return null;
    return THEME_TAGS.includes(raw) && TAG_CHOICES.includes(raw) ? raw : null;
}

type PostedPhoto = { id?: unknown; tags?: unknown; createdAt?: unknown; groupId?: unknown; userId?: unknown; uploadedBy?: unknown };

/** 写真がお題のタグを持ち、今週に投稿されたか */
function joinsThisWeek(p: PostedPhoto, theme: WeeklyThemeEntry, tagKeyOf: (t: string) => string,
                       range: { start: number; end: number }): boolean {
    const key = tagKeyOf(theme.tag);
    const tags = Array.isArray(p.tags) ? p.tags : [];
    if (!tags.some((x) => typeof x === "string" && tagKeyOf(x) === key)) return false;
    const at = postedAt(p);
    return at !== null && at >= range.start && at < range.end;
}

/**
 * **みんなの参加**（iOS の `WeeklyTheme.participants`）: 今週お題のタグを付けて載せた公開の投稿（新しい順・
 * 1 つの投稿は 1 枚＝いちばん新しい写真）。ホームの札に横に並べる
 */
export function themeParticipants<T extends PostedPhoto>(theme: WeeklyThemeEntry, photos: readonly T[],
                                                         tagKeyOf: (t: string) => string, now: Date = new Date()): T[] {
    const range = weekRange(now);
    const matched = photos.filter((p) => joinsThisWeek(p, theme, tagKeyOf, range))
        .sort((a, b) => ((postedAt(b) ?? 0) - (postedAt(a) ?? 0)) || (String(a.id) < String(b.id) ? -1 : 1));
    const seen = new Set<string>();
    return matched.filter((p) => {
        const key = groupKey(p);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * 今週のお題に**もう参加したか**（iOS の `WeeklyTheme.hasJoined`）。自分の写真のうち、お題のタグ（表記ゆれは
 * `tagKey` で畳む）を持ち、**投稿日が今週**の 1 枚があれば参加済み。参加済みの週は「参加する」を押せない「参加済み」に
 */
export function hasJoinedTheme(theme: WeeklyThemeEntry, myPhotos: readonly PostedPhoto[],
                               tagKeyOf: (t: string) => string, now: Date = new Date()): boolean {
    const range = weekRange(now);
    return myPhotos.some((p) => joinsThisWeek(p, theme, tagKeyOf, range));
}

/** 「今週 3件の投稿」（iOS の `WeeklyThemeText.participantsLine`） */
export function participantsLine(count: number, en: boolean): string {
    return en ? (count === 1 ? "1 post this week" : `${count} posts this week`) : `今週 ${count}件の投稿`;
}
