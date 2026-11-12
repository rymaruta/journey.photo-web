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
        expect(events).toBe(9);
        expect(b.split("Fn::ImportValue: sls-photo-gallery-user-api-${sls:stage}-CognitoAuthorizerId").length - 1).toBe(events);
        expect(yml).not.toMatch(/AWS::ApiGatewayV2::Authorizer/);
    });

    it("user API と同じ経路を持たない・HTTP API は取り込む（新しく作らない）", () => {
        const mine = routes(yml);
        const theirs = new Set(routes(userYml));
        expect(mine.length).toBe(10);
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
