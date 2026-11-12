import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * user API の HTTP API に経路を足す**別のスタック**（`api-user/serverless.*.yml`）の決まり
 * （札 journey.photo-ios#552 ②③・2026-11-12）。
 *
 * user API のスタック（`api-user/serverless.yml`）は CloudFormation の部品が上限 500 に近い（488）。
 * 機能のまとまりごとに別のスタックへ移し、新しい機能も別のスタックに置く。ここで縛ること:
 *  - 別のスタックは新しい HTTP API を作らず、user API が書き出す HttpApiId を取り込む（口の URL は変わらない）
 *  - ログインの要る口は、user API が書き出す認可（`CognitoAuthorizerId`）を使う。**自分で認可を作らない**
 *    （1つの HTTP API に置ける認可は 10 個まで。スタックごとに作ると増える一方）
 *  - 同じ経路（方法＋道）を2つのスタックが持たない（持つと後から配る方の反映が落ちる）
 *  - 移した関数は user API に残っていない（`MOVED`）
 *  - `deploy-api.yml` は user API の後に配る（取り込む値が先に要る）。例外は経路ごとの流量の設定を
 *    user API の段に付ける `spot-wants` だけで、こちらは先に配る
 *
 * YAML パーサは使わない（`logRetention.test.ts` と同じ理由）。
 */

const ROOT = join(__dirname, "..", "..");
const API_USER = join(ROOT, "api-user");
const noComments = (s: string) => s.replace(/^\s*#.*$/gm, "");
const read = (name: string) => readFileSync(join(API_USER, name), "utf8");

const USER_YML = read("serverless.yml");
const SPLIT = readdirSync(API_USER)
    .filter((n) => /^serverless\.[\w-]+\.yml$/.test(n))
    .sort();

/** 移した関数（スタックの設定ファイル → 関数の handler）。user API に残っていてはいけない */
const MOVED: Record<string, string[]> = {
    "serverless.albums.yml": [
        "src/albums.createAlbum", "src/albums.listAlbums", "src/albums.renameAlbum", "src/albums.deleteAlbum",
        "src/albums.createInvite", "src/albums.revokeInvite", "src/albums.joinAlbum", "src/albums.getInvite",
    ],
    "serverless.trips.yml": ["src/tripPlans.getMyTrips", "src/tripPlans.createTrip", "src/tripPlans.updateTrip", "src/tripPlans.deleteTrip"],
    "serverless.notifications.yml": [
        "src/notifications.getNotifications", "src/notifications.readNotifications", "src/devices.registerDevice", "src/devices.unregisterDevice",
    ],
    "serverless.trunk.yml": ["src/trunk.handler"],
    "serverless.stories.yml": [
        "src/stories.getStories", "src/stories.createStory", "src/stories.deleteStory", "src/stories.viewStory", "src/stories.getStoryViewers",
        "src/storyReplies.postStoryReply", "src/storyReplies.getStoryReplies", "src/storyVotes.voteStory",
        "src/storyAnswers.answerStory", "src/storyAnswers.getStoryAnswers", "src/storyAnswers.reportStoryAnswer",
        "src/storyKeep.keepStory", "src/storyArchive.getStoryArchive", "src/stories.cleanupExpiredStories",
        "src/highlights.createHighlight", "src/highlights.updateHighlight", "src/highlights.deleteHighlight",
        "src/highlights.getUserHighlights", "src/highlights.getHighlight",
    ],
};

const AUTH_IMPORT = "Fn::ImportValue: sls-photo-gallery-user-api-${sls:stage}-CognitoAuthorizerId";

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

/** httpApi の出来事（方法＋道・認可の書き方） */
function httpEvents(block: string): { route: string; auth: string | null }[] {
    return block
        .split(/- httpApi:\n/)
        .slice(1)
        .map((ev) => {
            const body = ev.split(/\n\s*- (?!\s)/)[0];
            const path = /path: (\S+)/.exec(body)?.[1];
            const method = /method: (\w+)/.exec(body)?.[1];
            const auth = /authorizer:\n([\s\S]*)/.exec(body)?.[1] ?? null;
            return { route: `${method?.toUpperCase()} ${path}`, auth };
        });
}

function allRoutes(src: string): string[] {
    return [...functionBlocks(src).values()].flatMap((b) => httpEvents(b).map((e) => e.route));
}

describe("user API が書き出すもの", () => {
    it("HTTP API の認可（cognitoAuthorizer）の ID を書き出す", () => {
        const out = noComments(USER_YML).split(/\n {2}Outputs:\n/)[1];
        expect(out).toBeDefined();
        expect(out).toMatch(/CognitoAuthorizerId:\n[\s\S]*?Ref: HttpApiAuthorizerCognitoAuthorizer\n[\s\S]*?Name: sls-\$\{self:service\}-\$\{sls:stage\}-CognitoAuthorizerId/);
        expect(USER_YML).toMatch(/^service: photo-gallery-user-api$/m);
        expect(noComments(USER_YML)).toMatch(/authorizers:\n\s+cognitoAuthorizer:\n\s+type: jwt/);
    });
});

describe("別のスタック（api-user/serverless.*.yml）", () => {
    it("別のスタックを見つけている", () => {
        expect(SPLIT).toEqual(expect.arrayContaining(["serverless.trip-share.yml", "serverless.profile-qr.yml", "serverless.spot-wants.yml"]));
    });

    for (const file of SPLIT) {
        const yml = read(file);
        const src = noComments(yml);

        describe(file, () => {
            it("HTTP API を新しく作らず、user API の HttpApiId を取り込む", () => {
                const provider = src.split(/\nfunctions:\n/)[0];
                expect(provider).toMatch(/httpApi:\n\s+id:\n\s+Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-HttpApiId/);
                expect(provider).not.toMatch(/\n\s+cors:/);
                expect(src).not.toMatch(/AWS::ApiGatewayV2::Api\b/);
            });

            it("認可を自分で作らず、ログインの要る口は user API が書き出す認可を使う", () => {
                expect(src).not.toMatch(/AWS::ApiGatewayV2::Authorizer/);
                expect(src).not.toMatch(/\n\s+authorizers:/);
                for (const [name, block] of functionBlocks(yml)) {
                    for (const ev of httpEvents(block)) {
                        if (ev.auth === null) continue;
                        expect(ev.auth, `${name} ${ev.route}`).toMatch(/^\s+type: jwt\n\s+id:\n\s+Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-CognitoAuthorizerId/);
                    }
                }
                expect(AUTH_IMPORT).toContain("CognitoAuthorizerId");
            });

            it("deploy-api.yml がこのスタックを配る（spot-wants 以外は user API の後）", () => {
                const wf = readFileSync(join(ROOT, ".github/workflows/deploy-api.yml"), "utf8");
                // user API のジョブの中で見る（管理 API のジョブにも同じ書き方の段がある）
                const job = wf.indexOf("\n  deploy-user-api:");
                expect(job).toBeGreaterThan(0);
                const user = wf.indexOf("npx serverless@3 deploy --stage", job);
                // 移した機能のまとまりは1つの段（`STACKS:` の一覧）でまとめて配る
                const stacksLine = /^\s+STACKS: (.+)$/m.exec(wf.slice(job));
                const listed = stacksLine?.[1].split(/\s+/).includes(file);
                const mine = listed ? job + stacksLine!.index : wf.indexOf(`--config ${file} `, job);
                expect(user).toBeGreaterThan(0);
                expect(mine, `${file} を配る段が無い`).toBeGreaterThan(0);
                if (file === "serverless.spot-wants.yml") expect(mine).toBeLessThan(user);
                else expect(mine).toBeGreaterThan(user);
            });
        });
    }

    it("同じ経路（方法＋道）を2つのスタックが持たない", () => {
        const seen = new Map<string, string>();
        for (const [file, src] of [["serverless.yml", USER_YML], ...SPLIT.map((f) => [f, read(f)])]) {
            for (const r of allRoutes(src)) {
                expect(seen.has(r), `${r} が ${seen.get(r)} と ${file} の両方にある`).toBe(false);
                seen.set(r, file);
            }
        }
        expect(seen.size).toBeGreaterThan(100);
    });

    it("移した機能のまとまりは user API の直後の段で配る（間に段を挟むと止まる時間が延びる）", () => {
        const wf = readFileSync(join(ROOT, ".github/workflows/deploy-api.yml"), "utf8");
        const job = wf.slice(wf.indexOf("\n  deploy-user-api:"));
        const steps = job.split(/\n {6}- name: /).slice(1).map((st) => st.split("\n")[0]);
        const user = steps.indexOf("Serverless deploy");
        expect(user).toBeGreaterThan(0);
        expect(steps[user + 1]).toBe("Serverless deploy（user API から移した機能・別スタック）");
        const listed = /^\s+STACKS: (.+)$/m.exec(job)![1].split(/\s+/).sort();
        expect(listed).toEqual(Object.keys(MOVED).sort());
    });

    it("移した機能のスタックは、環境変数と既定の役の権限が user API の provider と同じ（移す前と同じ環境で動く）", () => {
        const providerOf = (src: string) => noComments(src).split(/\nfunctions:\n/)[0];
        const envOf = (src: string) => providerOf(src).split(/\n {2}environment:\n/)[1].split(/\n {2}\w/)[0];
        const iamOf = (src: string) => providerOf(src).split(/\n {6}statements:\n/)[1].split(/\n {0,2}\w/)[0];
        const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
        expect(lines(iamOf(USER_YML)).length).toBeGreaterThan(30);
        for (const file of Object.keys(MOVED)) {
            const src = read(file);
            expect(lines(envOf(src)).sort(), file).toEqual(lines(envOf(USER_YML)).sort());
            expect(lines(iamOf(src)), file).toEqual(lines(iamOf(USER_YML)));
        }
    });

    it("使っていない資源の洗い出し（unused-resources.js）が別のスタックの関数を知っている", () => {
        const js = readFileSync(join(ROOT, "scripts/unused-resources.js"), "utf8");
        for (const file of SPLIT) {
            const service = /^service: (\S+)$/m.exec(read(file))![1];
            for (const stage of ["prod", "staging"]) expect(js, `${service}-${stage}-`).toContain(`"${service}-${stage}-"`);
        }
    });

    it("移した関数は user API に残っていない", () => {
        const userHandlers = new Set([...functionBlocks(USER_YML).values()].map((b) => /handler: (\S+)/.exec(b)?.[1]));
        for (const [file, handlers] of Object.entries(MOVED)) {
            const theirs = new Set([...functionBlocks(read(file)).values()].map((b) => /handler: (\S+)/.exec(b)?.[1]));
            for (const h of handlers) {
                expect(userHandlers.has(h), `${h} が user API に残っている`).toBe(false);
                expect(theirs.has(h), `${h} が ${file} に無い`).toBe(true);
            }
        }
    });
});
