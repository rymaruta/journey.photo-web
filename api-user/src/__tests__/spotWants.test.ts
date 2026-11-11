import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * みんなの「行きたい」を数える（2026-11-11・撮影スポットを払うの②・`spotWants.ts`）。
 *
 * 固定したいのは:
 *  1. 台帳にある撮影スポットの鍵だけ受ける・1回に10件まで・端末の ID の形・大きな本文は読む前に断る
 *  2. 同じ端末・同じ撮影スポットは月1回（重なりは数えない）
 *  3. 回線の上限を先に見る（1日300件・同じ撮影スポットは1日20件）→ 端末の1日50件
 *  4. IP は保存しない（行の鍵は塩と混ぜたハッシュ・生の IP はどこにも書かない）
 *  5. 10未満は配らない・急に増えたものは上位から外す（月初めの本物の人気は外さない）・順位は日本の撮影スポットだけ
 *  6. 古い行だけ・まとめて消す（数の配りとは別の関数）
 *  7. 権限は数の行の鍵の頭に絞る・この口だけ流量を絞る（serverless.yml）
 */
const mockDdbSend = vi.hoisted(() => vi.fn());
vi.mock("../dynamodb", () => ({ ddb: { send: mockDdbSend }, PHOTOS_TABLE: "photos-test" }));
const mockS3Send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: class { send = mockS3Send; },
    PutObjectCommand: class { constructor(public input: unknown) {} },
}));

const W = await import("../spotWants");
const JP = W.allSlugs().filter((s) => W.isJapanSpot(s));
const ABROAD = W.allSlugs().filter((s) => !W.isJapanSpot(s));
const SLUG = JP[0];
const SLUG2 = JP[1];
const DEVICE = "dev_abcdefghijklmnop";

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };
const calls = () => mockDdbSend.mock.calls.map(([c]) => c as Cmd);
const idOf = (c: Cmd) => String((c.input.Key as { id?: string } | undefined)?.id ?? "");
const ev = (body: unknown, ip = "203.0.113.7") => ({
    body: typeof body === "string" ? body : JSON.stringify(body),
    requestContext: { http: { method: "POST", sourceIp: ip } },
}) as never;
const run = async (e: never) => (await W.recordSpotWants(e, {} as never, () => undefined)) as { statusCode: number; body: string };
const condFail = () => Object.assign(new Error("x"), { name: "ConditionalCheckFailedException" });

beforeEach(() => {
    mockDdbSend.mockReset();
    mockS3Send.mockReset();
});

/** ddb の振る舞い: 塩は在る・上限と重なりは `fail` で断る */
function ddbWith(fail: (id: string) => boolean = () => false) {
    mockDdbSend.mockImplementation(async (c: Cmd) => {
        const id = idOf(c);
        if (c.constructor.name === "GetCommand") return { Item: id.startsWith("wantsalt#") ? { id, salt: "s" } : undefined };
        if (c.constructor.name === "UpdateCommand" && fail(id)) throw condFail();
        return {};
    });
}

describe("受ける鍵", () => {
    it("台帳にある鍵だけ・重なりを落とす・10件まで・SPOT- 付きでも受ける", () => {
        const p = W.parseWants(JSON.stringify({ device: DEVICE, slugs: [`SPOT-${SLUG}`, SLUG, "no-such-spot-xyz", 3, ...W.allSlugs().slice(1, 20)] }));
        expect(p?.slugs[0]).toBe(SLUG);
        expect(p?.slugs).not.toContain("no-such-spot-xyz");
        expect(p?.slugs.length).toBeLessThanOrEqual(W.MAX_PER_REQUEST);
        expect(new Set(p?.slugs).size).toBe(p?.slugs.length);
    });

    it("端末の ID の形が違う・壊れた本文は 400", async () => {
        expect(W.parseWants(JSON.stringify({ device: "short", slugs: [SLUG] }))).toBeNull();
        expect(W.parseWants(JSON.stringify({ device: "a b c d e f g h i j k l m n", slugs: [SLUG] }))).toBeNull();
        expect((await run(ev("{nope"))).statusCode).toBe(400);
    });

    it("大きな本文は JSON を読む前に 413（DB にも触らない）", async () => {
        ddbWith();
        const res = await run(ev(JSON.stringify({ device: DEVICE, slugs: [SLUG], pad: "x".repeat(W.MAX_BODY_BYTES) })));
        expect(res.statusCode).toBe(413);
        expect(mockDdbSend).not.toHaveBeenCalled();
    });
});

describe("数える", () => {
    it("回線の日の上限 → 回線・撮影スポットの日の上限 → 端末の日の上限 → 月1回 → 数を進める", async () => {
        ddbWith();
        const res = await run(ev({ device: DEVICE, slugs: [SLUG] }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ counted: 1 });
        const ups = calls().filter((c) => c.constructor.name === "UpdateCommand").map(idOf);
        const { month, day } = W.jstParts(new Date());
        expect(ups[0]).toMatch(new RegExp(`^wantip#${day}#[^#]+$`));
        expect(ups[1]).toMatch(new RegExp(`^wantip#${day}#[^#]+#${SLUG}$`));
        expect(ups[2]).toBe(`wantday#${day}#${DEVICE}`);
        expect(ups[3]).toBe(`wantby#${month}#${DEVICE}`);
        expect(ups[4]).toBe(`spotwant#${month}#${SLUG}`);
    });

    it("同じ端末・同じ撮影スポットはその月1回（数を進めない）", async () => {
        ddbWith((id) => id.startsWith("wantby#"));
        const res = await run(ev({ device: DEVICE, slugs: [SLUG, SLUG2] }));
        expect(JSON.parse(res.body)).toEqual({ counted: 0 });
        expect(calls().some((c) => idOf(c).startsWith("spotwant#"))).toBe(false);
    });

    it("端末の日の上限に達したら残りは数えない", async () => {
        ddbWith((id) => id.startsWith("wantday#"));
        expect(JSON.parse((await run(ev({ device: DEVICE, slugs: [SLUG, SLUG2] }))).body)).toEqual({ counted: 0 });
        const cond = calls().find((c) => idOf(c).startsWith("wantday#"))!.input;
        expect(cond.ConditionExpression).toContain("n < :max");
        expect((cond.ExpressionAttributeValues as Record<string, number>)[":max"]).toBe(W.DEVICE_DAILY_MAX);
    });

    it("回線の日の上限に達したら、端末の行も増やさずに止める（上限は300）", async () => {
        ddbWith((id) => /^wantip#[^#]+#[^#]+$/.test(id));
        expect(JSON.parse((await run(ev({ device: DEVICE, slugs: [SLUG, SLUG2] }))).body)).toEqual({ counted: 0 });
        const ipCall = calls().find((c) => idOf(c).startsWith("wantip#"))!;
        expect((ipCall.input.ExpressionAttributeValues as Record<string, number>)[":max"]).toBe(W.IP_DAILY_MAX);
        expect(calls().some((c) => idOf(c).startsWith("wantday#")), "上限のあとに端末の行を増やさない").toBe(false);
    });

    it("同じ回線・同じ撮影スポットは1日20件まで（その撮影スポットだけ飛ばし、ほかは数える）", async () => {
        ddbWith((id) => id.endsWith(`#${SLUG}`) && id.startsWith("wantip#"));
        expect(JSON.parse((await run(ev({ device: DEVICE, slugs: [SLUG, SLUG2] }))).body)).toEqual({ counted: 1 });
        const spotCall = calls().find((c) => idOf(c).endsWith(`#${SLUG}`) && idOf(c).startsWith("wantip#"))!;
        expect((spotCall.input.ExpressionAttributeValues as Record<string, number>)[":max"]).toBe(W.IP_SPOT_DAILY_MAX);
    });

    it("IPv6 は /64 にまとめて数える（下の 64 ビットを替えても同じ回線）", () => {
        expect(W.ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
        expect(W.ipBucket("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
        expect(W.ipBucket("2001:DB8:0001:0002:ffff::")).toBe("2001:db8:1:2::/64");
        expect(W.ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
        expect(W.ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
        expect(W.ipBucket("203.0.113.7")).toBe("203.0.113.7");
        expect(W.hashIp("2001:db8:1:2::1", "s")).toBe(W.hashIp("2001:db8:1:2:ffff:ffff:ffff:ffff", "s"));
        expect(W.hashIp("2001:db8:1:2::1", "s")).not.toBe(W.hashIp("2001:db8:1:3::1", "s"));
    });

    it("数える撮影スポットが無い要求は、塩も読まずにすぐ返す", async () => {
        ddbWith();
        const res = await run(ev({ device: DEVICE, slugs: ["no-such-spot-xyz"] }));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body)).toEqual({ counted: 0 });
        expect(mockDdbSend).not.toHaveBeenCalled();
    });

    it("生の IP はどこにも書かない（塩と混ぜたハッシュだけ）", async () => {
        ddbWith();
        await run(ev({ device: DEVICE, slugs: [SLUG] }, "198.51.100.23"));
        expect(JSON.stringify(mockDdbSend.mock.calls)).not.toContain("198.51.100.23");
        expect(W.hashIp("198.51.100.23", "a")).not.toBe(W.hashIp("198.51.100.23", "b"));
    });

    it("書き込みに失敗したら 500（数えたふりをしない）", async () => {
        mockDdbSend.mockRejectedValue(new Error("boom"));
        expect((await run(ev({ device: DEVICE, slugs: [SLUG] }))).statusCode).toBe(500);
    });
});

describe("毎日の集計", () => {
    it("10未満は載せない・印の付いたものは外す・同じ数は同じ順位", () => {
        const [a, b, c, d, e] = JP;
        const f = W.rankWants(new Map([[a, 30], [b, 12], [c, 12], [d, 9], [e, 100]]), new Set([e]), "2026-11", new Date(0));
        expect(f.spots.map(({ slug, n, rank }) => ({ slug, n, rank }))).toEqual([{ slug: a, n: 30, rank: 1 }, { slug: b, n: 12, rank: 2 }, { slug: c, n: 12, rank: 2 }]);
    });

    it("順位は日本の撮影スポットの中だけ・海外は数だけ（2026-11-11 判断）", () => {
        expect(ABROAD.length).toBeGreaterThan(0);
        const f = W.rankWants(new Map([[ABROAD[0], 500], [JP[0], 40], [JP[1], 20]]), new Set(), "2026-11", new Date(0));
        expect(f.spots.map(({ slug, n, rank }) => ({ slug, n, rank }))).toEqual([
            { slug: ABROAD[0], n: 500, rank: undefined }, { slug: JP[0], n: 40, rank: 1 }, { slug: JP[1], n: 20, rank: 2 }]);
    });

    it("急に増えた: 1日に30以上・しかも基準（前日までの数・前の月の半分・100）を越えた", () => {
        expect(W.isSpike(0, 30), "月初めに本物の人気が1日で30を超えても外さない").toBe(false);
        expect(W.isSpike(0, 99)).toBe(false);
        expect(W.isSpike(0, 101)).toBe(true);
        expect(W.isSpike(100, 140)).toBe(false);
        expect(W.isSpike(150, 320)).toBe(true);
        expect(W.isSpike(0, 300, 1000), "前の月に人気だった撮影スポットは月初めに多くても外さない").toBe(false);
        expect(W.isSpike(0, 29)).toBe(false);
    });

    it("日の行・回線の行・塩は2日以内に消える（プライバシーポリシーの約束・確かめ役の指摘 B1）", () => {
        expect(W.maxDayRowLifetimeHours()).toBeLessThan(48);
        // 掃除の時刻は serverless.yml の cron と同じ（19:47 UTC = 4:47 JST）
        const yml = readFileSync(join(__dirname, "..", "..", "serverless.yml"), "utf-8");
        const m = /cleanupSpotWants:[\s\S]*?cron\((\d+) (\d+) /.exec(yml);
        expect(m, "cleanupSpotWants の cron が無い").not.toBeNull();
        const jst = (Number(m![2]) + 9) % 24 + Number(m![1]) / 60;
        expect(Math.abs(jst - W.CLEANUP_HOUR_JST)).toBeLessThan(0.05);
        const page = readFileSync(join(__dirname, "..", "..", "..", "app", "privacy", "page.tsx"), "utf-8");
        expect(page).toContain("2日以内に消します");
    });

    it("消すのは前の月より古い重なり止めと、今日より前の日の行・回線の行・塩だけ", () => {
        const month = "2026-11", day = "2026-11-11";
        expect(W.isExpiredRow("wantby#2026-09#d", month, day)).toBe(true);
        expect(W.isExpiredRow("wantby#2026-10#d", month, day)).toBe(false);
        expect(W.isExpiredRow("wantday#2026-11-09#d", month, day)).toBe(true);
        expect(W.isExpiredRow("wantday#2026-11-10#d", month, day), "前日の行も消す（今日より前）").toBe(true);
        expect(W.isExpiredRow("wantday#2026-11-11#d", month, day), "今日の行は残す").toBe(false);
        expect(W.isExpiredRow("wantsalt#2026-11-10", month, day)).toBe(true);
        expect(W.isExpiredRow("wantip#2026-11-10#h", month, day)).toBe(true);
        expect(W.isExpiredRow("wantip#2026-11-09#h#slug", month, day)).toBe(true);
        expect(W.isExpiredRow("wantsalt#2026-11-09", month, day)).toBe(true);
        expect(W.isExpiredRow("spotwant#2025-01#a", month, day), "数の行は消さない").toBe(false);
        expect(W.isExpiredRow("spots#user", month, day)).toBe(false);
        // 年をまたぐ
        expect(W.isExpiredRow("wantby#2025-12#d", "2026-01", "2026-01-01")).toBe(false);
        expect(W.isExpiredRow("wantday#2025-12-31#d", "2026-01", "2026-01-01")).toBe(true);
        expect(W.isExpiredRow("wantby#2025-11#d", "2026-01", "2026-01-01")).toBe(true);
    });

    it("数を読み、印を残し、Web の置き場の1ファイルに書く（掃除はしない）", async () => {
        process.env.SITE_BUCKET = "site-test";
        const { month } = W.jstParts(new Date());
        mockDdbSend.mockImplementation(async (c: Cmd) => {
            const n = c.constructor.name;
            if (n === "BatchGetCommand") {
                const keys = (c.input.RequestItems as Record<string, { Keys: { id: string }[] }>)["photos-test"].Keys;
                return { Responses: { "photos-test": keys.filter((k) => k.id === `spotwant#${month}#${SLUG}` || k.id === `spotwant#${month}#${SLUG2}`)
                    .map((k) => ({ id: k.id, n: k.id.endsWith(SLUG) ? 20 : 140 })) } };
            }
            if (n === "GetCommand") return idOf(c) === `spotwantsnap#${month}` ? { Item: { counts: { [SLUG]: 19, [SLUG2]: 0 }, flagged: [] } } : {};
            return {};
        });
        await W.aggregateSpotWants({} as never, {} as never, () => undefined);
        const put = mockS3Send.mock.calls[0][0].input as { Bucket: string; Key: string; Body: string };
        expect(put.Bucket).toBe("site-test");
        expect(put.Key).toBe("app/data/spot-wants.json");
        const file = JSON.parse(put.Body);
        // SLUG2 は 0 → 140 で急に増えた＝外す
        expect(file.spots.map(({ slug, n, rank }: { slug: string; n: number; rank: number }) => ({ slug, n, rank }))).toEqual([{ slug: SLUG, n: 20, rank: 1 }]);
        expect(file.spots[0].name, "名前も配る（頁が索引を読まずに出せる）").toBeTruthy();
        const snap = calls().find((c) => c.constructor.name === "PutCommand")!.input.Item as { flagged: string[] };
        expect(snap.flagged).toEqual([SLUG2]);
        expect(calls().some((c) => ["ScanCommand", "BatchWriteCommand", "DeleteCommand"].includes(c.constructor.name)), "掃除は別の関数").toBe(false);
    });

    it("掃除: 古い行だけを 25 件ずつまとめて消し、消せなかった分はやり直す", async () => {
        const { month } = W.jstParts(new Date());
        const old = Array.from({ length: 30 }, (_, i) => ({ id: `wantby#2000-01#d${i}` }));
        let first = true;
        mockDdbSend.mockImplementation(async (c: Cmd) => {
            if (c.constructor.name === "ScanCommand") return { Items: [...old, { id: `wantby#${month}#keep` }] };
            if (c.constructor.name === "BatchWriteCommand") {
                const reqs = (c.input.RequestItems as Record<string, unknown[]>)["photos-test"];
                if (first) { first = false; return { UnprocessedItems: { "photos-test": reqs.slice(0, 2) } }; }
                return {};
            }
            return {};
        });
        await W.cleanupSpotWants({} as never, {} as never, () => undefined);
        const batches = calls().filter((c) => c.constructor.name === "BatchWriteCommand")
            .map((c) => (c.input.RequestItems as Record<string, { DeleteRequest: { Key: { id: string } } }[]>)["photos-test"]);
        expect(batches.map((b) => b.length)).toEqual([25, 2, 5]);
        const ids = batches.flat().map((r) => r.DeleteRequest.Key.id);
        expect(ids).not.toContain(`wantby#${month}#keep`);
        expect(new Set(ids).size).toBe(30);
    });
});

describe("権限と流量（serverless.yml）", () => {
    const yml = readFileSync(join(__dirname, "..", "..", "serverless.yml"), "utf-8");
    const block = (name: string) => yml.slice(yml.indexOf(`    ${name}:`), yml.indexOf("\n    # ", yml.indexOf(`    ${name}:`) + 10));

    it("受ける口と集計の役は、数の行の鍵の頭にだけ書ける（写真の行は消せない）", () => {
        for (const role of ["SpotWantsRecordRole", "SpotWantsAggregateRole"]) {
            const b = block(role);
            expect(b, role).toContain("dynamodb:LeadingKeys");
            for (const head of ["spotwant*", "wantby#*", "wantday#*", "wantip#*", "wantsalt#*"]) expect(b, `${role} ${head}`).toContain(`- ${head}`);
        }
        const agg = block("SpotWantsAggregateRole");
        // 削除・まとめ書きは条件つきの文の中だけ（Scan だけの文に入れない）
        const scanStmt = agg.slice(agg.indexOf("- dynamodb:Scan") - 80);
        expect(scanStmt).not.toContain("DeleteItem");
        expect(block("SpotWantsRecordRole")).not.toContain("DeleteItem");
    });

    it("この口だけ流量を絞る", () => {
        expect(yml).toContain('"POST /spots/wants":');
        // 段の経路ごとの設定は経路ができてから（論理名は sls package で確かめた）
        expect(yml).toMatch(/HttpApiStage:\s*\n(?:\s*#.*\n)*\s*DependsOn:\s*\n\s*- HttpApiRoutePostSpotsWants/);
        expect(yml).toMatch(/ThrottlingRateLimit: \d+/);
        expect(yml).toMatch(/ThrottlingBurstLimit: \d+/);
        expect(yml).toContain("cleanupSpotWants:");
    });
});
