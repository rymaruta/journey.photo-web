import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * グループの会話の**別スタック**（`api-user/serverless.groups.yml`・2026-11-12 札 journey.photo-ios#582）。
 *
 * owner 承認の範囲（行の種類を5つ・`dmday#` の欄を2つ・このスタック。GSI・表・TTL・SQS は無し）を設定の上でも縛る:
 *  - 口は11で関数は1つ。全部 user API が書き出す認可（`CognitoAuthorizerId`）を通る（未認証の口は無い）
 *  - **新しい表・索引・待ち行列・関数を作らない**（`resources` を持たない・関数は1つ）
 *  - 書けるのはグループの5つの行だけ（Get/Put/Delete/BatchGet）。ほかの行に書けるのは 1日の歯止め（`dmday#`）と
 *    端末の宛先（`devices#`）の UpdateItem だけ。DM の会話・ブロック・フォローには書けない
 *  - 知らせはこの関数の中で送る（APNs の鍵を5つ持つ・15秒まで待つ）
 */

const ROOT = join(__dirname, "..", "..");
const yml = readFileSync(join(ROOT, "api-user/serverless.groups.yml"), "utf8");
const noComments = (s: string) => s.replace(/^\s*#.*$/gm, "");
const src = noComments(yml);

function statements(text: string): Array<{ actions: string[]; resources: string[]; keys: string[] }> {
    const body = text.split(/\n {6}statements:\n/)[1].split(/\n(?=[a-zA-Z]|  [a-zA-Z])/)[0];
    return body.split(/\n(?= {8}- Effect:)/).filter((b) => b.includes("Effect:")).map((b) => ({
        actions: [...b.matchAll(/^\s*-\s+((?:dynamodb|s3|cloudfront|sqs|lambda):[A-Za-z]+)\s*$/gm)].map((m) => m[1]),
        resources: [...b.matchAll(/^\s*-\s+(arn:\S+)\s*$/gm)].map((m) => m[1]),
        keys: [...b.matchAll(/^\s*-\s+([a-z]+#\*)\s*$/gm)].map((m) => m[1]),
    }));
}

describe("グループの会話の別スタック", () => {
    it("関数は1つ・口は11で、全部ログインが要る（user API の認可を取り込む）", () => {
        const fns = src.split(/\nfunctions:\n/)[1];
        expect([...fns.matchAll(/^ {2}(\w+):$/gm)].map((m) => m[1])).toEqual(["groups"]);
        expect(fns).toMatch(/handler: src\/groups\.handler/);
        const events = fns.split("- httpApi:").length - 1;
        expect(events).toBe(11);
        expect(fns.split("Fn::ImportValue: sls-photo-gallery-user-api-${sls:stage}-CognitoAuthorizerId").length - 1).toBe(events);
        const routes = [...fns.matchAll(/path: (\S+)\n\s+method: (\w+)/g)].map((m) => `${m[2]} ${m[1]}`).sort();
        expect(routes).toEqual([
            "DELETE /groups/{gid}/invite", "DELETE /groups/{gid}/members/{uid}",
            "GET /groups", "GET /groups/{gid}", "GET /groups/{gid}/messages",
            "POST /groups", "POST /groups/{gid}/join", "POST /groups/{gid}/members", "POST /groups/{gid}/messages", "POST /groups/{gid}/report",
            "PUT /groups/{gid}",
        ]);
    });

    it("口の道はコードの道（routeKey）と一致する", () => {
        const code = readFileSync(join(ROOT, "api-user/src/groups.ts"), "utf8");
        const fromCode = [...code.matchAll(/route === "((?:GET|POST|PUT|DELETE) \/groups[^"]*)"/g)].map((m) => m[1]);
        const fromYml = [...src.matchAll(/path: (\S+)\n\s+method: (\w+)/g)].map((m) => `${m[2]} ${m[1]}`);
        expect([...new Set(fromCode)].sort()).toEqual([...fromYml].sort());
    });

    it("🔴 新しい表・索引・待ち行列・別の関数を作らない（resources を持たない）", () => {
        expect(src).not.toMatch(/\nresources:/);
        expect(src).not.toMatch(/AWS::(DynamoDB|SQS|ApiGatewayV2::(Api|Authorizer))/);
        expect(src).toMatch(/httpApi:\n\s+id:\n\s+Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-HttpApiId/);
    });

    it("🔴 書けるのはグループの5つの行と、1日の歯止め・端末の宛先の UpdateItem だけ", () => {
        const st = statements(src);
        const photos = st.filter((s) => s.resources.some((r) => r.endsWith("table/${param:photosTable}")));
        expect(photos.length).toBeGreaterThan(0);
        for (const s of photos) {
            const writes = s.actions.filter((a) => a !== "dynamodb:GetItem" && a !== "dynamodb:BatchGetItem");
            if (writes.length === 0) continue;
            // 鍵の頭で絞らない書く権限を持たない
            expect(s.keys.length, writes.join(",")).toBeGreaterThan(0);
            for (const k of ["dm#*", "dminbox#*", "block#*", "blocks#*", "blockedby#*", "follow#*", "trip#*"]) expect(s.keys).not.toContain(k);
        }
        const groupRows = photos.find((s) => s.keys.includes("group#*") && s.actions.includes("dynamodb:PutItem"))!;
        expect(groupRows.keys.sort()).toEqual(["group#*", "groupchat#*", "groupmembers#*", "groupreport#*", "groupsjoined#*"]);
        expect(groupRows.actions.sort()).toEqual(["dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem"]);
        const updates = photos.filter((s) => s.actions.includes("dynamodb:UpdateItem"));
        expect(updates.flatMap((s) => s.actions)).toEqual(["dynamodb:UpdateItem"]);
        expect(updates.flatMap((s) => s.keys).sort()).toEqual(["devices#*", "dmday#*"]);
        // 利用者の表は読むだけ
        const usersSt = st.filter((s) => s.resources.some((r) => r.endsWith("table/${param:usersTable}")));
        expect(usersSt.flatMap((s) => s.actions).sort()).toEqual(["dynamodb:BatchGetItem", "dynamodb:GetItem"]);
    });

    // 2026-11-12 確かめ役の指摘4: 前は写真の表ぜんたいの GetItem・BatchGetItem を許していた
    it("🔴 写真の表を読む範囲も絞る（BatchGet は2つの頭だけ・頭の無い読みは欄の条件つきだけ）", () => {
        const body = src.split(/\n {6}statements:\n/)[1].split(/\n(?=[a-zA-Z]|  [a-zA-Z])/)[0];
        const blocks = body.split(/\n(?= {8}- Effect:)/).filter((b) => b.includes("Effect:") && b.includes("table/${param:photosTable}"));
        const batch = statements(src).filter((s) => s.resources.some((r) => r.endsWith("table/${param:photosTable}")) && s.actions.includes("dynamodb:BatchGetItem"));
        expect(batch).toHaveLength(1);
        expect(batch[0].actions).toEqual(["dynamodb:BatchGetItem"]);
        expect(batch[0].keys.sort()).toEqual(["devices#*", "group#*"]);
        const unkeyed = blocks.filter((b) => !b.includes("dynamodb:LeadingKeys"));
        expect(unkeyed).toHaveLength(1);
        const b = unkeyed[0];
        expect([...b.matchAll(/^\s*-\s+(dynamodb:[A-Za-z]+)\s*$/gm)].map((m) => m[1])).toEqual(["dynamodb:GetItem"]);
        expect(b).toMatch(/ForAllValues:StringEquals:\n\s+dynamodb:Attributes:\n/);
        expect(b).toMatch(/StringEqualsIfExists:\n\s+dynamodb:Select: SPECIFIC_ATTRIBUTES/);
        // 欄の指定の無い読み（ForAllValues は空の集合で真になる）を断る
        expect(b).toMatch(/'Null':\n\s+dynamodb:Attributes: 'false'/);
        const attrs = b.split("dynamodb:Attributes:\n")[1].split(/\n\s+[A-Z']/)[0].match(/- (\w+)/g)!.map((x) => x.slice(2));
        // 写真を読む口（`photoVisibility.ts`）の ProjectionExpression の欄とそろう
        const code = readFileSync(join(ROOT, "api-user/src/photoVisibility.ts"), "utf8");
        const proj = /ProjectionExpression: "([^"]+)"/.exec(code)![1].split(",").map((x) => x.trim().replace("#id", "id").replace("#loc", "location"));
        expect(attrs.sort()).toEqual(proj.sort());
    });

    it("知らせはこの関数の中で送る（APNs の鍵を5つ・15秒まで待つ）", () => {
        const fn = src.split(/\nfunctions:\n/)[1];
        for (const v of ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_PRIVATE_KEY", "APNS_TOPIC", "APNS_HOST"]) expect(fn).toContain(v);
        expect(fn).toMatch(/^\s{4}timeout: 15\s*$/m);
        expect(src.split(/\nfunctions:\n/)[0]).not.toContain("APNS_");
    });

    it("deploy-api.yml は user API の後にこのスタックを配る", () => {
        const wf = readFileSync(join(ROOT, ".github/workflows/deploy-api.yml"), "utf8");
        const user = wf.indexOf("npx serverless@3 deploy --stage");
        const mine = wf.indexOf("--config serverless.groups.yml ");
        expect(user).toBeGreaterThan(0);
        expect(mine).toBeGreaterThan(user);
    });
});
