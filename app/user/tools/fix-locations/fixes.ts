/**
 * 撮影地の一括修正（1回きり）の中身。画面から切り離してあるのは、
 * 「送るのは `{ location }` だけ」「同じなら送らない」「1枚の失敗で止まらない」を
 * 画面なしで試験するため。
 *
 * 値は `shooting-places-draft.csv`（確度 ◎ の行だけ）から**埋め込んだ**。実行時には何も読まない。
 * ○ の行・「変更なし」の行は含めない。
 */

export type LocationFix = { id: string; title: string; location: string };

export const LOCATION_FIXES: readonly LocationFix[] = [
    { id: "a129394d-f386-4795-9623-2d6e915d20c7", title: "白鳥と湖", location: "山梨県 山中湖村" },
    { id: "88c66c1d-c2fc-4875-9b52-55756db18dbc", title: "木を覆う苔", location: "山梨県 山中湖村" },
    { id: "edb09f51-c821-4ec4-8b84-6ea467d77131", title: "未完の大聖堂", location: "スペイン バルセロナ サグラダ・ファミリア" },
    { id: "a5951859-7334-43c6-9e6a-e65d8c6fe70f", title: "ヴァンドーム広場", location: "フランス パリ ヴァンドーム広場" },
    { id: "ab5e9442-d146-4eb4-9506-89cb8ed18daf", title: "秋のグラデーション", location: "大阪府 大阪市 夢洲（大阪・関西万博 会場）" },
    { id: "50b9f638-c86c-4df7-95ad-0bc2050ec535", title: "紅白", location: "東京都" },
    { id: "65300204-f4d3-4faf-9724-6cdd83bda35a", title: "Cafe", location: "東京都 大田区 多摩川駅 Cafe&Bar Delight" },
    { id: "30891834-7d3b-45c4-a3c5-d5d455b725a2", title: "カンプのディナー", location: "フィンランド ヘルシンキ ホテル・カンプ" },
    { id: "8e82737f-5a6a-43b1-b42d-07d6b1913f2b", title: "紫陽花", location: "東京都 大田区 多摩川台公園" },
    { id: "98846554-af2e-4e99-8da0-5edb06c1f430", title: "森の呼吸", location: "福岡県 太宰府市 宝満宮 竈門神社" },
    { id: "1f724eba-ea68-4310-9996-b3d7e47065a7", title: "石のディテールと光の諧調", location: "フランス ヴェルサイユ ヴェルサイユ宮殿 小トリアノン" },
    { id: "3efd3a7c-a625-473e-9622-8daaffca1cf8", title: "サーリセルカの街灯", location: "フィンランド サーリセルカ" },
    { id: "d0e10f85-6e15-4e1a-a298-f5a968195492", title: "北欧の朝", location: "フィンランド" },
    { id: "18c7ad60-5600-4020-bbe0-edc84332e9ce", title: "北海道の桜", location: "北海道 札幌市 羊ヶ丘展望台" },
    { id: "e4e47af3-08e9-4791-8fd3-d8688a52d22c", title: "オペラ・ガルニエ", location: "フランス パリ オペラ・ガルニエ" },
    { id: "e2ff51a0-3364-4b9d-a6a3-c4a2c837b006", title: "フィンランドの大地", location: "フィンランド" },
    { id: "27501725-7d8b-4ff8-a5db-21e458145fcc", title: "レストランからの夕焼け", location: "フィンランド" },
    { id: "f854f680-602d-4cc4-9ac5-a98c06fb8c1a", title: "Löylyのレストラン", location: "フィンランド ヘルシンキ Löyly" },
    { id: "3729f868-9f21-4cef-913f-f05bc16b3255", title: "森の中の小屋", location: "フィンランド" },
    { id: "fa0d51c9-f3ff-4812-bc29-4d88515081ea", title: "北欧の森", location: "フィンランド" },
    { id: "21cf9fd2-e836-431d-85cd-cf41da7e56e9", title: "ヘルシンキの街並み", location: "フィンランド ヘルシンキ" },
    { id: "cb10f0d4-4fe1-4fb7-b72f-24cf72e69866", title: "ピザ店の窓", location: "フィンランド" },
    { id: "2354a297-a017-4001-afbf-70e9d9fa36f7", title: "ヘルシンキ大聖堂", location: "フィンランド ヘルシンキ 元老院広場" },
    { id: "ca5a98b3-27c2-42d4-a26c-a3437609ec31", title: "Löyly", location: "フィンランド ヘルシンキ Löyly" },
    { id: "bb470019-c4a2-484e-bdbd-51e4b20fa4ef", title: "木こりのろうそく橋", location: "フィンランド ロヴァニエミ" },
];

export type RowStatus = "pending" | "done" | "skipped" | "foreign" | "running" | "failed";

/** 現在値の読み取り結果（`GET /user/photos` の行から作る）。自分の写真に無い id は null */
export type Current = { location: string } | null;

/** 画面に出す状態。現在値が新しい値と同じなら「済み」、自分の写真に無ければ「対象外」 */
export function initialStatus(fix: LocationFix, current: Current): RowStatus {
    if (!current) return "foreign";
    return current.location.trim() === fix.location ? "skipped" : "pending";
}

export type FetchLike = (path: string, init: { method: string; body: string }) => Promise<{
    ok: boolean; status: number; error?: string;
}>;

export type RowResult = { id: string; status: "done" | "foreign" | "failed"; message?: string };

/**
 * 1枚ずつ順に送る。**送る本文は `{ location }` だけ**（他の項目は送らない＝消えない）。
 * `statuses` が済み・対象外の行は送らない（続きから再実行できる）。
 * 1枚が失敗（例外も含む）しても次へ進む。
 */
export async function applyFixes(
    fixes: readonly LocationFix[],
    statuses: Readonly<Record<string, RowStatus>>,
    put: FetchLike,
    onResult: (r: RowResult) => void,
    onStart?: (id: string) => void,
): Promise<void> {
    for (const fix of fixes) {
        const st = statuses[fix.id];
        if (st !== "pending" && st !== "failed") continue;
        onStart?.(fix.id);
        try {
            const res = await put(`/photos/${encodeURIComponent(fix.id)}`, {
                method: "PUT",
                body: JSON.stringify({ location: fix.location }),
            });
            if (res.ok) onResult({ id: fix.id, status: "done" });
            else if (res.status === 403) onResult({ id: fix.id, status: "foreign", message: "あなたの写真ではないため、変更できません" });
            else onResult({ id: fix.id, status: "failed", message: res.error || `保存に失敗しました（${res.status}）` });
        } catch (e) {
            onResult({ id: fix.id, status: "failed", message: e instanceof Error ? e.message : "保存に失敗しました" });
        }
    }
}
