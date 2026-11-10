import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
    default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
        const attrs: Record<string, unknown> = { ...rest };
        delete attrs.prefetch;
        return <a href={href} {...attrs}>{children}</a>;
    },
}));

const trackMock = vi.fn();
vi.mock("../../lib/utils/analytics", async (orig) => ({
    ...(await orig<typeof import("../../lib/utils/analytics")>()),
    track: (...args: unknown[]) => trackMock(...args),
}));

import { LocaleProvider } from "../i18n/context";
import SpotAreaIndexClient from "../components/SpotAreaIndexClient";
import { resetSpotSearchIndex } from "../../lib/hooks/useSpotSearchIndex";
import type { SpotArea } from "../../lib/data/spotLink";
import type { SpotSearchRow } from "../../lib/utils/spots";

/**
 * **撮影スポット一覧（`/spots`）の検索窓**（2026-11-09）の画面の振る舞い。規則そのものは
 * `lib/utils/__tests__/spotListSearch.test.ts`。ここは配線（入力 → 絞り込み → 表示・URL・IME・静的HTML・計測）を見る。
 */
const AREAS: SpotArea[] = [
    { slug: "yamagata", name: "山形県", nameEn: "Yamagata", region: "東北", count: 3, publishedCount: 3 },
    { slug: "kyoto", name: "京都府", nameEn: "Kyoto", region: "近畿", count: 2, publishedCount: 2 },
];
const ROWS: SpotSearchRow[] = [
    { s: "ginzan-onsen", n: "銀山温泉", r: "ぎんざんおんせん", g: "山形県 尾花沢市", image: { src: "/images/spots/thumb/ginzan-onsen.jpg" } },
    { s: "zao-okama", n: "蔵王のお釜", r: "ざおうのおかま", g: "山形県 山形市" },
    { s: "yamadera", n: "山寺", r: "やまでら", g: "山形県 山形市" },
    { s: "kiyomizu", n: "清水寺", r: "きよみずでら", g: "京都府 京都市" },
];

const JUMPS = [{ id: "spots-by-season", label: "季節", labelEn: "Season" }];

function Page({ jumps = JUMPS }: { jumps?: typeof JUMPS }) {
    return (
        <LocaleProvider>
            <SpotAreaIndexClient areas={AREAS} total={5} draftCount={0} jumps={jumps}>
                <div data-testid="topic-sections"><span>春</span></div>
            </SpotAreaIndexClient>
        </LocaleProvider>
    );
}

const input = () => screen.getByTestId("spots-search-input") as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

beforeEach(() => {
    trackMock.mockReset();
    resetSpotSearchIndex();
    window.history.replaceState(null, "", "/spots");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(ROWS), { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("検索窓の見た目と静的HTML", () => {
    it("最上部に、名前（label）・44px・クリアボタン付きの検索窓がある", () => {
        render(<Page />);
        const el = screen.getByRole("searchbox", { name: "撮影スポットを検索" });
        expect(el).toBe(input());
        expect(input().style.minHeight).toBe("44px");
        expect(screen.getByRole("search")).toBeTruthy();
        // 空のあいだはクリアボタンも結果の欄も出ない
        expect(screen.queryByTestId("spots-search-clear")).toBeNull();
        expect(screen.queryByTestId("spots-search-results")).toBeNull();
        // 入れるとクリアボタン（44px）
        type("a");
        expect(screen.getByTestId("spots-search-clear").style.width).toBe("44px");
    });

    it("🔴 サーバーで描いた HTML には、県のリンクと切り口の節が入ったまま（検索の表示でクローラー向けのリンクを消さない）", () => {
        const html = renderToStaticMarkup(<Page />);
        expect(html).toContain('href="/spots/area/yamagata"');
        expect(html).toContain('href="/spots/area/kyoto"');
        expect(html).toContain('data-testid="topic-sections"');
        expect(html).toContain('data-testid="spots-search-input"');
        // 最初は隠さない・結果の欄も無い
        expect(html).not.toMatch(/\shidden(=|>|\s)/);
        expect(html).not.toContain('data-testid="spots-search-results"');
    });
});

describe("絞り込み", () => {
    it("打つたびに絞る（Enter 不要）。結果は既存の一覧の行（リンク・地域・丸い印）で、件数を出す", async () => {
        const { container } = render(<Page />);
        type("ギンザン");
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toBe("公開中の撮影スポットのうち 1件が当たりました。"));
        const results = screen.getByTestId("spots-search-results");
        const link = within(results).getByRole("link", { name: /銀山温泉/ });
        expect(link.getAttribute("href")).toBe("/spots/ginzan-onsen");
        expect(link.textContent).toContain("山形県 尾花沢市");
        // 小さい版の写真が在る行は丸い印（img）、無い行はピン
        expect(container.querySelector('img[src="/images/spots/thumb/ginzan-onsen.jpg"]')).not.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledWith("/app/data/spot-search.json");
        type("ギンザンおんせん");
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toBe("公開中の撮影スポットのうち 1件が当たりました。"));
    });

    it("県名で当たったとき、県の一覧へのリンクも出す。結果がある間は静的な一覧を隠す（DOM には残す）", async () => {
        render(<Page />);
        type("山形");
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toBe("公開中の撮影スポットのうち 3件が当たりました。"));
        const areas = screen.getByTestId("spots-search-areas");
        expect(within(areas).getByRole("link", { name: /山形県/ }).getAttribute("href")).toBe("/spots/area/yamagata");
        const list = screen.getByTestId("spots-default-list");
        expect(list.hasAttribute("hidden")).toBe(true);
        expect(within(list).getByTestId("topic-sections")).toBeTruthy(); // 消えてはいない
    });

    it("0件: 「見つかりません」と、県の一覧への導線（隠さない一覧）", async () => {
        render(<Page />);
        type("ぞぞぞぞ");
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toContain("見つかりません"));
        const list = screen.getByTestId("spots-default-list");
        expect(list.hasAttribute("hidden")).toBe(false);
        expect(within(list).getByRole("link", { name: /京都府/ }).getAttribute("href")).toBe("/spots/area/kyoto");
    });

    it("クリアすると、ふだんの一覧に戻る", async () => {
        render(<Page />);
        type("山形");
        await waitFor(() => screen.getByTestId("spots-search-results"));
        fireEvent.click(screen.getByTestId("spots-search-clear"));
        expect(input().value).toBe("");
        expect(screen.queryByTestId("spots-search-results")).toBeNull();
        expect(screen.getByTestId("spots-default-list").hasAttribute("hidden")).toBe(false);
    });

    it("索引が取れなかったら、その旨を言う（固まらない）", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
        render(<Page />);
        type("山形");
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toContain("準備ができませんでした"));
    });

    it("語が空のあいだは索引を取りに行かない（探さない人に130KBを配らない）", () => {
        render(<Page />);
        type("   ");
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.queryByTestId("spots-search-results")).toBeNull();
    });
});

describe("日本語入力（IME）", () => {
    it("変換中は絞らない。確定したら絞る", async () => {
        render(<Page />);
        fireEvent.compositionStart(input());
        type("ぎ");
        type("ぎんざ");
        // 入力欄には見えているが、絞り込み（結果の欄・索引の取得）はまだ
        expect(input().value).toBe("ぎんざ");
        expect(screen.queryByTestId("spots-search-results")).toBeNull();
        expect(fetch).not.toHaveBeenCalled();
        type("銀山");
        fireEvent.compositionEnd(input());
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toBe("公開中の撮影スポットのうち 1件が当たりました。"));
    });

    it("変換の確定の Enter ではキーボードを閉じない。ふつうの Enter では閉じる", () => {
        render(<Page />);
        input().focus();
        expect(document.activeElement).toBe(input());
        fireEvent.keyDown(input(), { key: "Enter", keyCode: 229, isComposing: true });
        expect(document.activeElement).toBe(input());
        fireEvent.keyDown(input(), { key: "Enter", keyCode: 13 });
        expect(document.activeElement).not.toBe(input());
    });
});

describe("URL の ?q=", () => {
    it("打った語を ?q= に残す（履歴は積まない）。空にすると消える", async () => {
        const before = window.history.length;
        render(<Page />);
        type("山形");
        await waitFor(() => expect(new URLSearchParams(window.location.search).get("q")).toBe("山形"));
        expect(window.history.length).toBe(before);
        fireEvent.click(screen.getByTestId("spots-search-clear"));
        await waitFor(() => expect(window.location.search).toBe(""));
    });

    it("?q= 付きで開くと、入力欄と結果が復元される（戻る・共有）", async () => {
        window.history.replaceState(null, "", "/spots?q=%E5%B1%B1%E5%AF%BA");
        render(<Page />);
        await waitFor(() => expect(input().value).toBe("山寺"));
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toBe("公開中の撮影スポットのうち 1件が当たりました。"));
    });

    it("結果のリンクを押す直前に URL へ流す（250ms 待たずに離れても、戻ると復元される）", async () => {
        render(<Page />);
        type("山寺");
        await waitFor(() => screen.getByRole("link", { name: /山寺/ }));
        expect(window.location.search).toBe("");
        const link = screen.getByRole("link", { name: /山寺/ });
        // 遷移そのもの（jsdom が URL を変える）は止める。流れるのは遷移より前（捕捉の段）
        link.addEventListener("click", (e) => e.preventDefault());
        fireEvent.click(link);
        expect(new URLSearchParams(window.location.search).get("q")).toBe("山寺");
    });
});

describe("計測", () => {
    it("検索語そのものは送らない（長さと件数だけ・spots_search）", async () => {
        render(<Page />);
        type("ぎんざん");
        await waitFor(() => expect(trackMock).toHaveBeenCalled(), { timeout: 4000 });
        const [name, params] = trackMock.mock.calls[0] as [string, Record<string, unknown>];
        expect(name).toBe("spots_search");
        expect(params).toEqual({ search_term_length: 4, result_count: 1 });
        expect(JSON.stringify(trackMock.mock.calls)).not.toContain("ぎんざん");
    }, 8000);
});


/**
 * **見づらさの直し**（2026-11-09・owner「見づらい」）。本番 390px の実測: 県のチップは高さ 34（押せる範囲 44）・地は黒との差 1.12:1・
 * 件数 12px・縁は白8%。県の札（高さ 48・名前 15 semibold・件数 13・縁 白14%）と、ページ内の近道の帯にした。
 */
describe("県の札とページ内の近道", () => {
    // 2026-11-10 案A（札 rymaruta/journey.photo-ios#516）: 県の一覧は写真の札。写真を渡さなければ「名前だけの札」
    it("県の札は県の頁へのリンクで、名前 15px・件数 12px。写真の無い札は名前だけ（縁 白14%・件数は text-2）", () => {
        render(<Page />);
        const tile = screen.getByRole("link", { name: /山形県/ });
        expect(tile.getAttribute("href")).toBe("/spots/area/yamagata");
        expect(tile.getAttribute("data-photo")).toBe("0");
        expect(tile.querySelector("img")).toBeNull();
        expect(tile.className).toContain("aspect-square");
        expect(tile.className).toContain("ring-line-strong");
        const name = within(tile).getByText("山形県");
        const count = within(tile).getByText("3");
        expect(name.style.fontSize).toBe("15px");
        expect(count.style.fontSize).toBe("12px");
        expect(count.className).toContain("text-text-2");
    });

    it("地方の見出しに、その地方の件数が出る", () => {
        render(<Page />);
        expect(document.getElementById("spots-region-東北")!.textContent).toBe("東北3件");
        expect(document.getElementById("spots-region-近畿")!.textContent).toBe("近畿2件");
    });

    it("近道の帯: 描いている地方と、渡された節だけが並び、行き先は同じページの見出し（死んだリンクが無い）", () => {
        render(<Page />);
        const band = screen.getByTestId("spots-jump-band");
        const hrefs = within(band).getAllByRole("link").map((a) => a.getAttribute("href"));
        expect(hrefs).toEqual(["#spots-region-東北", "#spots-region-近畿", "#spots-by-season"]);
        // 地方の行き先は実在する見出し
        expect(document.getElementById("spots-region-東北")).not.toBeNull();
        expect(document.getElementById("spots-region-近畿")).not.toBeNull();
        // 押せる範囲 44（CHIP_HIT: 上下 5px ずつ広げる）
        for (const a of within(band).getAllByRole("link")) expect(a.className).toContain("before:-inset-y-[5px]");
    });

    it("節が無ければ、その行き先は出さない。近道の帯は静的HTMLにも入っている", () => {
        const html = renderToStaticMarkup(<Page jumps={[]} />);
        expect(html).toContain('data-testid="spots-jump-band"');
        expect(html).not.toContain("#spots-by-season");
        expect(html).toContain('href="#spots-region-東北"');
    });

    it("検索結果の「地域の一覧を見る」も同じ県の札", async () => {
        render(<Page />);
        type("山形");
        await waitFor(() => screen.getByTestId("spots-search-areas"));
        const tile = within(screen.getByTestId("spots-search-areas")).getByRole("link", { name: /山形県/ });
        expect(tile.style.minHeight).toBe("48px");
    });
});


/** **レビューで直した配線**（2026-11-09） */
describe("読み上げ欄・IME・フォーカス・ちらつき・計測", () => {
    it("🔴 件数の読み上げ欄（role=status）は語が入る前から在り、同じ要素の中身だけが入れ替わる", async () => {
        render(<Page />);
        const before = screen.getByRole("status");
        expect(before.textContent).toBe("");
        type("ぎんざん");
        await waitFor(() => expect(before.textContent).toBe("公開中の撮影スポットのうち 2件が当たりました。".replace("2件", "1件")));
        expect(screen.getByRole("status")).toBe(before);   // 作り直していない
        type("");
        await waitFor(() => expect(before.textContent).toBe(""));
        expect(screen.getByRole("status")).toBe(before);
    });

    it("IME: compositionend が来ずに ref が固まっても、isComposing=false の入力で絞り込みが動く", async () => {
        render(<Page />);
        fireEvent.compositionStart(input());            // 終わりが来ない
        fireEvent.input(input(), { target: { value: "山寺" }, isComposing: false });
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toContain("1件"));
    });

    it("IME: 変換の途中で入力欄を離れたら、字に追いついて絞り込む", async () => {
        render(<Page />);
        fireEvent.compositionStart(input());
        type("山寺");
        expect(screen.queryByTestId("spots-search-results")).toBeNull();
        fireEvent.blur(input());
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toContain("1件"));
    });

    it("「さらに表示」を押したら、新しく出た最初の行にフォーカスが移る", async () => {
        const many: SpotSearchRow[] = Array.from({ length: 45 }, (_, i) => ({ s: `t${i}`, n: `テスト景色${i}`, g: "山形県 山形市" }));
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(many), { status: 200 })));
        render(<Page />);
        type("テスト景色");
        await waitFor(() => screen.getByTestId("spots-search-more"));
        fireEvent.click(screen.getByTestId("spots-search-more"));
        await waitFor(() => expect(document.activeElement?.getAttribute("href")).toBe("/spots/t30"));
    });

    it("🔴 ?q= の復元中（索引の取得中）は静的な一覧を隠したまま。届いて0件になったときだけ戻す", async () => {
        let release: (r: Response) => void = () => {};
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { release = res; })));
        window.history.replaceState(null, "", "/spots?q=%E5%B1%B1%E5%AF%BA");
        render(<Page />);
        await waitFor(() => expect(input().value).toBe("山寺"));
        expect(screen.getByTestId("spots-default-list").hasAttribute("hidden")).toBe(true);
        release(new Response(JSON.stringify([]), { status: 200 }));
        await waitFor(() => expect(screen.getByTestId("spots-default-list").hasAttribute("hidden")).toBe(false));
    });

    it("復元された ?q= では spots_search を送らない（打ったときだけ）", async () => {
        window.history.replaceState(null, "", "/spots?q=%E5%B1%B1%E5%AF%BA");
        render(<Page />);
        await waitFor(() => expect(screen.getByTestId("spots-search-status").textContent).toContain("1件"));
        await new Promise((r) => setTimeout(r, 1800));
        expect(trackMock).not.toHaveBeenCalled();
    }, 8000);
});
