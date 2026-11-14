import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 旅行プランを仲間と使う口の**別スタック**（`api-user/serverless.trip-share.yml`・2026-11-12）。
 *
 * user API のスタックは部品が 488/500。ここで縛ること:
 *  - 未認証の口は招待の下見（`getTripInvite`）だけで、役は招待とプランの本体を GetItem で読むだけ
 *  - ほかの口は全部 user API が書き出す認可（`CognitoAuthorizerId`）を通る
 *  - user API と同じ経路（方法＋道）を持たない（同じ経路を2つのスタックが持つと反映が落ちる）
 *  - `deploy-api.yml` は user API を配った**後**にこのスタックを配る（HttpApiId を取り込むため）
 */

const ROOT = join(__dirname, "..", "..");
const yml = readFileSync(join(ROOT, "api-user/serverless.trip-share.yml"), "utf8");
const userYml = readFileSync(join(ROOT, "api-user/serverless.yml"), "utf8");
const noComments = (s: string) => s.replace(/^\s*#.*$/gm, "");

/** 関数名 → その関数のブロック */
function functionBlocks(src: string): Map<string, string> {
    const body = noComments(src).split(/\nfunctions:\n/)[1].split(/\n(?=[a-zA-Z])/)[0];
    const out = new Map<string, string>();
    for (const part of ("\n" + body).split(/\n(?=  \w+:\n)/)) {
        const m = /^\n?  (\w+):/.exec(part);
        if (m) out.set(m[1], part);
    }
    return out;
}

/** 「方法 道」の一覧 */
function routes(src: string): string[] {
    const out: string[] = [];
    for (const m of noComments(src).matchAll(/path: (\S+)\n\s+method: (\w+)/g)) out.push(`${m[2].toUpperCase()} ${m[1]}`);
    return out;
}

describe("旅行プランの共有の別スタック", () => {
    const blocks = functionBlocks(yml);

    it("未認証の口は getTripInvite だけで、専用の読むだけの役で動く", () => {
        const open = [...blocks].filter(([, b]) => b.includes("httpApi:") && !b.includes("authorizer:")).map(([n]) => n);
        expect(open).toEqual(["getTripInvite"]);
        expect(blocks.get("getTripInvite")).toMatch(/^\s{4}role: TripInviteReadRole\s*$/m);
        const role = noComments(yml).split(/\n {4}TripInviteReadRole:\n/)[1];
        const actions = [...role.matchAll(/^\s*-\s+([a-z0-9-]+:[A-Za-z]+)\s*$/gm)].map((m) => m[1]);
        expect(actions.sort()).toEqual(["dynamodb:GetItem", "logs:CreateLogStream", "logs:PutLogEvents"]);
        expect(role).toMatch(/- invite#\*\n\s+- trip#\*\s*$/);
    });

    it("認証の口は全部 user API が書き出す認可を通る（自分で認可を作らない・#552 ③）", () => {
        const b = blocks.get("tripShare")!;
        const events = b.split("- httpApi:").length - 1;
        expect(events).toBe(10);
        expect(b.split("Fn::ImportValue: sls-photo-gallery-user-api-${sls:stage}-CognitoAuthorizerId").length - 1).toBe(events);
        expect(yml).not.toMatch(/AWS::ApiGatewayV2::Authorizer/);
    });

    it("user API と同じ経路を持たない・HTTP API は取り込む（新しく作らない）", () => {
        const mine = routes(yml);
        const theirs = new Set(routes(userYml));
        expect(mine.length).toBe(11);
        for (const r of mine) expect(theirs.has(r), r).toBe(false);
        expect(yml).toMatch(/Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-HttpApiId/);
    });

    it("deploy-api.yml は user API の後にこのスタックを配る", () => {
        const wf = readFileSync(join(ROOT, ".github/workflows/deploy-api.yml"), "utf8");
        const user = wf.indexOf("npx serverless@3 deploy --stage");
        const mine = wf.indexOf("--config serverless.trip-share.yml");
        expect(user).toBeGreaterThan(0);
        expect(mine).toBeGreaterThan(user);
    });
});

/**
 * 役の権限（2026-11-12 確かめ役の指摘2・7・8）。
 *  - user API の役は写真の表を BatchGetItem で読める（`listSharedTrips`。無いと共有プランに入った人の一覧が 500）
 *  - 共有の口の役は、DM の会話・ブロックを**読むだけ**（書けるのは端末の宛先の掃除と会話の1日の歯止めの UpdateItem だけ）
 *  - 共有の口の関数は 15 秒まで待つ
 */
describe("旅行プランの共有の権限", () => {
    /** provider の iam の文を1つずつ（Action・Resource・LeadingKeys） */
    function statements(src: string): Array<{ actions: string[]; resources: string[]; keys: string[] }> {
        const body = noComments(src).split(/\n {6}statements:\n/)[1].split(/\n(?=[a-zA-Z]|  [a-zA-Z])/)[0];
        return body.split(/\n(?= {8}- Effect:)/).filter((b) => b.includes("Effect:")).map((b) => ({
            actions: [...b.matchAll(/^\s*-\s+((?:dynamodb|s3|cloudfront):[A-Za-z]+)\s*$/gm)].map((m) => m[1]),
            resources: [...b.matchAll(/^\s*-\s+(arn:\S+)\s*$/gm)].map((m) => m[1]),
            keys: [...b.matchAll(/^\s*-\s+([a-z]+#\*)\s*$/gm)].map((m) => m[1]),
        }));
    }
    const photos = (s: { resources: string[] }) => s.resources.some((r) => r.endsWith("table/${param:photosTable}"));

    it("user API の役は写真の表を BatchGetItem で読める", () => {
        const s = statements(userYml).filter(photos);
        expect(s.length).toBeGreaterThan(0);
        expect(s.some((x) => x.actions.includes("dynamodb:BatchGetItem"))).toBe(true);
    });

    it("共有の口の役は DM・ブロックの行に書けない（読むだけ）", () => {
        const mine = statements(yml).filter(photos);
        expect(mine.length).toBeGreaterThan(0);
        for (const st of mine) {
            const writes = st.actions.filter((a) => a !== "dynamodb:GetItem" && a !== "dynamodb:BatchGetItem");
            if (writes.length === 0) continue;
            for (const k of ["dm#*", "block#*", "blocks#*", "blockedby#*"]) expect(st.keys, `${k} に ${writes.join(",")}`).not.toContain(k);
            // 鍵の頭で絞らない書く権限を持たない
            expect(st.keys.length, writes.join(",")).toBeGreaterThan(0);
        }
        // 端末の宛先と1日の歯止めに書けるのは UpdateItem だけ
        for (const k of ["devices#*", "dmday#*"]) {
            const acts = mine.filter((st) => st.keys.includes(k)).flatMap((st) => st.actions).filter((a) => a !== "dynamodb:GetItem");
            expect(acts.sort(), k).toEqual(["dynamodb:UpdateItem"]);
        }
    });

    it("会話の通報の写し（`tripreport#`）は GetItem と PutItem だけ（押し直しで前の写しを読む・2026-11-14 #597。無いと通報が 500）", () => {
        const mine = statements(yml).filter(photos);
        const acts = mine.filter((st) => st.keys.includes("tripreport#*")).flatMap((st) => st.actions);
        expect(acts.sort()).toEqual(["dynamodb:GetItem", "dynamodb:PutItem"]);
        expect(routes(yml)).toContain("POST /trip-share/{planId}/report");
    });

    it("共有の口の関数は 15 秒まで待つ（知らせを送る間に切れない）", () => {
        expect(functionBlocks(yml).get("tripShare")).toMatch(/^\s{4}timeout: 15\s*$/m);
    });
});
