import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contentTypeFor, putParamsFor, AASA_KEY, AASA_EDGE_KEY } = require("../deploy-static-site.js") as {
    contentTypeFor: (key: string) => string;
    putParamsFor: (key: string) => { ContentType: string };
    AASA_KEY: string;
    AASA_EDGE_KEY: string;
};

/**
 * **アプリのリンクの宣言（AASA）**（2026-11-18・札 rymaruta/journey.photo-ios#545 の段2）。
 *
 * iOS はこのファイルを読み、ここに書いた道（パス）のリンクをアプリで開く。
 * アプリに受ける画面がある所だけを書く——ログイン・登録・設定・投稿・Pro の頁はアプリへ飛ばさない。
 * 🔴 **ここに道を足したら、iOS の振り分けにも同じ道を足す**（アプリが開いて何も出ない、を作らない）。
 */
const root = path.resolve(__dirname, "../..");
const aasa = JSON.parse(fs.readFileSync(path.join(root, "public", AASA_KEY), "utf8")) as {
    applinks: { details: Array<{ appIDs: string[]; components: Array<{ "/": string; "?"?: Record<string, string>; exclude?: boolean }> }> };
};

/** Apple の照合の形（`*` は0字以上・`/` も含む、`?` は1字）を正規表現にする */
function glob(p: string): RegExp {
    const body = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${body}$`);
}

/** 上から順に見て、最初に合った部品で決まる（合わなければアプリでは開かない） */
function opensInApp(url: string): boolean {
    const u = new URL(url, "https://journey-photo.com");
    for (const d of aasa.applinks.details) {
        for (const c of d.components) {
            if (!glob(c["/"]).test(u.pathname)) continue;
            if (c["?"] && !Object.entries(c["?"]).every(([k, v]) => glob(v).test(u.searchParams.get(k) ?? ""))) continue;
            return !c.exclude;
        }
    }
    return false;
}

describe("apple-app-site-association", () => {
    it("アプリは本番の iOS アプリ1つ（チームID とバンドルID は iOS の署名と同じ）", () => {
        // チームID 5T76NZUL2L は TestFlight の署名の記録（配布証明書 Apple Distribution の括弧の中）、
        // バンドルID は journey.photo-ios の Config/Production.xcconfig の JP_BUNDLE_ID
        expect(aasa.applinks.details.map((d) => d.appIDs)).toEqual([["5T76NZUL2L.com.journeyphoto.JourneyPhoto"]]);
    });

    it("アプリに画面がある道はアプリで開く", () => {
        for (const url of [
            "/spots/abukumado", "/spots/abukumado?app=save", "/photo/abc123", "/users/u-1", "/users?id=u-1",
            "/trips", "/t?t=tok", "/j?t=tok", "/qr?t=tok",
        ]) expect(opensInApp(url), url).toBe(true);
    });

    it("ログイン・登録・設定・投稿・Pro・一覧の頁はアプリへ飛ばさない", () => {
        for (const url of [
            "/", "/login", "/signup", "/user/settings", "/user/upload", "/user/light", "/admin",
            "/spots", "/spots/area/kanto", "/spots/city/kyoto/kyoto", "/spots/season/spring", "/spots/sakura",
            "/spots/sakura/tokyo", "/spots/momiji", "/spots/snow", "/spots/theme/temple/kyoto",
            "/users", "/users/search", "/users/trip", "/t", "/j", "/qr", "/privacy", "/terms",
        ]) expect(opensInApp(url), url).toBe(false);
    });

    it("/spots/ の下の一覧の頁（[slug] 以外の頁）は、どれも外してある", () => {
        // 新しい一覧の頁を足したとき、観光スポットの頁と間違えてアプリへ飛ばさない
        const dir = path.join(root, "app", "spots");
        const lists = fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith("[") && !e.name.startsWith("_"))
            .map((e) => e.name);
        expect(lists.length).toBeGreaterThan(0);
        for (const name of lists) {
            // その道そのものに頁がある（さくら・紅葉・雪）なら外す。下の階層は全部外す
            if (fs.existsSync(path.join(dir, name, "page.tsx"))) expect(opensInApp(`/spots/${name}`), name).toBe(false);
            expect(opensInApp(`/spots/${name}/x`), name).toBe(false);
        }
    });

    it("配るときは application/json（本番の書き換えで読まれる .html の写しも）", () => {
        expect(AASA_EDGE_KEY).toBe(`${AASA_KEY}.html`);
        expect(contentTypeFor(AASA_KEY)).toBe("application/json");
        expect(contentTypeFor(AASA_EDGE_KEY)).toBe("application/json");
        // S3 へ実際に渡す値（上げる・上げないの判定の指紋もここから作る）
        expect(putParamsFor(AASA_KEY).ContentType).toBe("application/json");
        expect(putParamsFor(AASA_EDGE_KEY).ContentType).toBe("application/json");
        // ほかは今までどおり
        expect(contentTypeFor("spots/abukumado.html")).toBe("text/html");
        expect(contentTypeFor("robots.txt")).toBe("text/plain");
        expect(contentTypeFor("app/data/photos.json")).toBe("application/json");
    });
});
