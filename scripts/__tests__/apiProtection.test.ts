import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * API を守る（流量の上限）と、知らせが届く（SNS の宛先とアラーム）の決まり
 * （2026-11-25・AWS の見直しの 2 と 3。owner「2（API が守られていない）、3（知らせが届かない）もおねがい！まもる！」）。
 *
 *  - user API と管理 API の段に、**すべての口**にかかる既定の流量の上限（DefaultRouteSettings）がある。
 *    別のスタック（`api-user/serverless.*.yml`）の口は user API の HTTP API に乗るので、user API の既定がかかる
 *  - AI の口はほかより厳しい。口ごとの設定を付ける経路は、user API より先に配るスタックが持つ
 *  - ログインなしで呼べる `GET /photos` の役は、表の全部を読めない（Scan を持たない）
 *  - 知らせの宛先とアラーム（`api/monitoring.yml`）。アラームは本番だけ・数を絞る・宛先のメールをリポジトリに書かない
 *
 * YAML パーサは使わない（`logRetention.test.ts`・`splitStacks.test.ts` と同じ理由）。
 */

const ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const noComments = (s: string) => s.replace(/^\s*#.*$/gm, "");

const USER_YML = noComments(read("api-user", "serverless.yml"));
const ADMIN_YML = noComments(read("api", "serverless.yml"));
const DEPLOY = read(".github", "workflows", "deploy-api.yml");
const MONITORING_RAW = read("api", "monitoring.yml");
const MONITORING = noComments(MONITORING_RAW);

/** `extensions:` → `HttpApiStage:` の Properties の中身 */
function stageProps(yml: string): string {
    const m = /\n {2}extensions:\n {4}HttpApiStage:\n {6}Properties:\n([\s\S]*?)(?=\n {2}\S|\n\S|$)/.exec(yml);
    expect(m, "extensions.HttpApiStage.Properties が無い").not.toBeNull();
    return m![1];
}

function defaultLimits(yml: string): { rate: number; burst: number } {
    const props = stageProps(yml);
    const m = /DefaultRouteSettings:\n\s+ThrottlingRateLimit: (\d+)\n\s+ThrottlingBurstLimit: (\d+)/.exec(props);
    expect(m, "DefaultRouteSettings に ThrottlingRateLimit と ThrottlingBurstLimit が無い").not.toBeNull();
    return { rate: Number(m![1]), burst: Number(m![2]) };
}

/** RouteSettings の口ごとの値（Fn::If の枝ごとに全部） */
function routeSettings(yml: string): { route: string; rate: number; burst: number }[] {
    const props = stageProps(yml);
    const rs = props.split(/RouteSettings:\n/)[2] ?? props.split(/RouteSettings:\n/)[1] ?? "";
    return [...rs.matchAll(/"([A-Z]+ [^"]+)":\n\s+ThrottlingRateLimit: (\d+)\n\s+ThrottlingBurstLimit: (\d+)/g)]
        .map((m) => ({ route: m[1], rate: Number(m[2]), burst: Number(m[3]) }));
}

/** スタックの設定 → 経路（方法＋道） */
function routesOf(yml: string): string[] {
    const src = noComments(yml);
    const a = [...src.matchAll(/- httpApi:\s*\n\s+path: (\S+)\s*\n\s+method: (\S+)/g)].map((m) => `${m[2].toUpperCase()} ${m[1]}`);
    const b = [...src.matchAll(/- httpApi:\s*\n\s+method: (\S+)\s*\n\s+path: (\S+)/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
    return [...a, ...b];
}

describe("流量の上限（すべての口）", () => {
    it("user API の段に、すべての口にかかる既定の上限がある（秒 20・瞬間 40）", () => {
        const { rate, burst } = defaultLimits(USER_YML);
        expect(rate).toBe(20);
        expect(burst).toBe(40);
        // 根拠の数（本番の 14 日の最大 317/分 ≒ 秒 5.3）を下回らない。上げ過ぎもしない
        expect(rate).toBeGreaterThanOrEqual(6);
        expect(rate).toBeLessThanOrEqual(100);
        expect(burst).toBeGreaterThanOrEqual(rate);
    });

    it("管理 API の段にも既定の上限がある（ログインなしの GET /photos を含む）", () => {
        const { rate, burst } = defaultLimits(ADMIN_YML);
        expect(rate).toBe(5);
        expect(burst).toBe(10);
        expect(routesOf(read("api", "serverless.yml"))).toContain("GET /photos");
    });

    it("別のスタックの口は user API の HTTP API に乗る（user API の既定の上限がかかる）", () => {
        const split = readdirSync(join(ROOT, "api-user")).filter((n) => /^serverless\.[\w-]+\.yml$/.test(n));
        expect(split.length).toBeGreaterThan(10);
        for (const f of split) {
            const provider = noComments(read("api-user", f)).split(/\nfunctions:\n/)[0];
            expect(provider, f).toMatch(/httpApi:\n\s+id:\n\s+Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-HttpApiId/);
        }
    });

    it("AI の口（POST /user/trip-ai）は、どの枝でも既定より厳しい", () => {
        const def = defaultLimits(USER_YML);
        const ai = routeSettings(USER_YML).filter((r) => r.route === "POST /user/trip-ai");
        // Fn::If の3つの枝（Google あり・Apple だけ・どちらもなし）全部に
        expect(ai).toHaveLength(3);
        for (const r of ai) {
            expect(r.rate).toBeLessThan(def.rate);
            expect(r.burst).toBeLessThan(def.burst);
            expect(r.rate).toBe(2);
            expect(r.burst).toBe(5);
        }
    });

    it("ログインの口（Apple・Google）も既定より厳しい", () => {
        const def = defaultLimits(USER_YML);
        const auth = routeSettings(USER_YML).filter((r) => r.route.startsWith("POST /auth/"));
        expect(auth.length).toBeGreaterThanOrEqual(3);
        for (const r of auth) expect(r.rate).toBeLessThan(def.rate);
    });

    it("口ごとの設定を付ける経路は、どれかのスタックに在り、そのスタックは user API より先に配る", () => {
        // 無い経路に設定を付けると反映が落ちる。別スタックの経路は、user API の段より先に作られていないといけない
        const job = DEPLOY.slice(DEPLOY.indexOf("\n  deploy-user-api:"));
        const userStep = job.indexOf("\n      - name: Serverless deploy\n");
        expect(userStep).toBeGreaterThan(0);
        const owners = new Map<string, string>();
        for (const f of readdirSync(join(ROOT, "api-user")).filter((n) => /^serverless\.[\w-]+\.yml$/.test(n))) {
            for (const r of routesOf(read("api-user", f))) owners.set(r, f);
        }
        const own = new Set(routesOf(read("api-user", "serverless.yml")));
        const routes = [...new Set(routeSettings(USER_YML).map((r) => r.route))];
        expect(routes).toContain("POST /user/trip-ai");
        for (const r of routes) {
            if (own.has(r)) continue;
            const f = owners.get(r);
            expect(f, `${r} を持つスタックが無い`).toBeDefined();
            const at = job.indexOf(`--config ${f} `);
            expect(at, `${f} を配る段が無い`).toBeGreaterThan(0);
            expect(at, `${f}（${r}）は user API より先に配る`).toBeLessThan(userStep);
        }
    });
});

describe("ログインなしで呼べる GET /photos の役", () => {
    it("管理 API の PublicReadRole は Scan を持たない（公開一覧は索引の Query）", () => {
        const m = /^ {4}PublicReadRole:$([\s\S]*?)(?=^ {4}\w+:$|^ {2}\w+:$|(?![\s\S]))/m.exec(ADMIN_YML);
        expect(m, "PublicReadRole が見つからない").not.toBeNull();
        expect(m![1]).toContain("dynamodb:Query");
        expect(m![1]).not.toContain("dynamodb:Scan");
        expect(m![1]).toContain("/index/*");
    });

    it("GET /photos と GET /photos/{id} は PublicReadRole で動く", () => {
        for (const fn of ["getPhotos", "getPhoto"]) {
            const block = new RegExp(`\\n  ${fn}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n)`).exec(ADMIN_YML);
            expect(block, fn).not.toBeNull();
            expect(block![1]).toMatch(/role: PublicReadRole/);
        }
    });
});

describe("知らせの宛先とアラーム（api/monitoring.yml）", () => {
    const resources = () => [...MONITORING.matchAll(/^ {2}(\w+):\n {4}Type: ([\w:]+)\n(?: {4}Condition: (\w+)\n)?/gm)]
        .map((m) => ({ name: m[1], type: m[2], condition: m[3] }));

    it("宛先（SNS のトピック）を1つ作り、環境ごとに名前を分ける", () => {
        const topics = resources().filter((r) => r.type === "AWS::SNS::Topic");
        expect(topics).toHaveLength(1);
        expect(topics[0].condition).toBeUndefined();
        expect(MONITORING).toContain("TopicName: !Sub journey-photo-alerts-${EnvName}");
    });

    it("宛先の決まりは CloudWatch のアラームと Budgets からの知らせを、このアカウントの分だけ受ける", () => {
        expect(MONITORING).toMatch(/Service: cloudwatch\.amazonaws\.com\n\s+Action: sns:Publish/);
        expect(MONITORING).toMatch(/Service: budgets\.amazonaws\.com\n\s+Action: sns:Publish/);
        expect(MONITORING.match(/aws:SourceAccount: !Ref AWS::AccountId/g)).toHaveLength(2);
    });

    it("アラームは本番だけ。見る数は 11 まで（1つ月 0.1 ドル。無料の枠は 10）", () => {
        const alarms = resources().filter((r) => r.type === "AWS::CloudWatch::Alarm");
        expect(alarms.map((a) => a.name).sort()).toEqual([
            "AdminApi5xxAlarm", "BedrockInvocationsAlarm", "LambdaErrorsAlarm", "LambdaThrottlesAlarm",
            "PhotosTableThrottlesAlarm", "ScheduledJobsErrorsAlarm", "UserApi5xxAlarm",
        ]);
        for (const a of alarms) expect(a.condition, a.name).toBe("IsProd");
        // 見る数: 1つの数を見るアラームは 1、式のアラームは MetricStat の数
        const blocks = MONITORING.split(/\n(?= {2}\w+:\n {4}Type: )/);
        let metrics = 0;
        for (const b of blocks) {
            if (!/Type: AWS::CloudWatch::Alarm/.test(b)) continue;
            const stats = (b.match(/MetricStat:/g) ?? []).length;
            metrics += stats > 0 ? stats : 1;
            expect(b, "知らせ先がこのトピック").toContain("AlarmActions: [!Ref AlertTopic]");
        }
        expect(metrics).toBe(11);
    });

    it("予算（AWS Budgets）はここで作らない（もう2つある。3つ目から有料）", () => {
        expect(MONITORING).not.toMatch(/AWS::Budgets::Budget/);
    });

    it("宛先のメールはリポジトリに書かない（引数は NoEcho、反映は secrets の ALERT_EMAIL から）", () => {
        expect(MONITORING_RAW).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
        expect(MONITORING).toMatch(/AlertEmail:\n\s+Type: String\n\s+Default: ""\n\s+NoEcho: true/);
        expect(MONITORING).toMatch(/AlertEmailSubscription:\n\s+Type: AWS::SNS::Subscription\n\s+Condition: HasEmail/);
        expect(DEPLOY).toContain("ALERT_EMAIL: ${{ secrets.ALERT_EMAIL }}");
        expect(DEPLOY).toContain("aws cloudformation deploy");
        expect(DEPLOY).toContain("--template-file monitoring.yml");
        // 管理 API のジョブで配る
        const admin = DEPLOY.slice(DEPLOY.indexOf("\n  deploy-admin-api:"), DEPLOY.indexOf("\n  deploy-user-api:"));
        expect(admin).toContain("--template-file monitoring.yml");
    });

    it("定時の関数のアラームが見る関数は、本当に在る（名前がずれると黙って何も見なくなる）", () => {
        const names = [...MONITORING.matchAll(/Value: !Sub (photo-gallery-[\w-]+)-\$\{EnvName\}-(\w+)/g)].map((m) => [m[1], m[2]]);
        expect(names).toHaveLength(4);
        const services = new Map<string, string>();
        for (const f of ["serverless.yml", ...readdirSync(join(ROOT, "api-user")).filter((n) => /^serverless\.[\w-]+\.yml$/.test(n))]) {
            const src = read("api-user", f);
            const svc = /^service: (\S+)$/m.exec(src)![1];
            services.set(svc, noComments(src));
        }
        for (const [svc, fn] of names) {
            const src = services.get(svc);
            expect(src, `${svc} のスタックが無い`).toBeDefined();
            const block = new RegExp(`\\n  ${fn}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|\\n\\S|$)`).exec(src!);
            expect(block, `${svc} に関数 ${fn} が無い`).not.toBeNull();
            expect(block![1], `${svc}-${fn} は定時の関数`).toMatch(/- schedule: cron\(/);
        }
    });

    it("見張る表とモデルの名前が、反映とコードの値と同じ", () => {
        expect(MONITORING).toContain("Value: !Sub ${EnvName}-photo-gallery-photos");
        expect(DEPLOY).toContain("photosTable=prod-photo-gallery-photos");
        const model = /export const TRIP_AI_MODEL_ID = "([^"]+)"/.exec(read("api-user", "src", "tripAiConfig.ts"))![1];
        expect(MONITORING).toMatch(new RegExp(`BedrockModelId:\\n\\s+Type: String\\n\\s+Default: ${model.replace(/[.:]/g, "\\$&")}\\n`));
        // API の 5xx は、それぞれの API が書き出す HttpApiId を見る
        expect(MONITORING).toContain("Fn::Sub: sls-photo-gallery-user-api-${EnvName}-HttpApiId");
        expect(MONITORING).toContain("Fn::Sub: sls-photo-gallery-api-${EnvName}-HttpApiId");
        expect(/^service: photo-gallery-api$/m.test(ADMIN_YML)).toBe(true);
    });
});
