import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    CFN_RESOURCE_LIMIT, FAIL_ABOVE, FROZEN_AT, WARN_ABOVE,
    countResources, judge, requiredParams, serverlessConfigNames,
    substituteAccountId, summaryMarkdown, typeBreakdown,
} from "../lib/stackSize.mjs";

/** 部品を n 個持つ小さなテンプレート（関数・ロググループ・経路を順に混ぜる） */
function template(n: number) {
    const types = ["AWS::Lambda::Function", "AWS::Logs::LogGroup", "AWS::ApiGatewayV2::Route"];
    const Resources: Record<string, { Type: string }> = {};
    for (let i = 0; i < n; i++) Resources[`R${i}`] = { Type: types[i % types.length] };
    return { AWSTemplateFormatVersion: "2010-09-09", Resources };
}

describe("スタックの部品の数（札 journey.photo-ios#552）", () => {
    it("線は 500 の上限・450 で失敗・400 で警告", () => {
        expect(CFN_RESOURCE_LIMIT).toBe(500);
        expect(FAIL_ABOVE).toBe(450);
        expect(WARN_ABOVE).toBe(400);
    });

    it("449 個は通る（警告）・450 個も通る・451 個は落ちる", () => {
        expect(judge(countResources(template(449)))).toBe("warn");
        expect(judge(countResources(template(450)))).toBe("warn");
        expect(judge(countResources(template(451)))).toBe("fail");
    });

    it("400 以下は ok・401 から警告", () => {
        expect(judge(countResources(template(400)))).toBe("ok");
        expect(judge(countResources(template(401)))).toBe("warn");
        expect(judge(countResources(template(0)))).toBe("ok");
    });

    it("数は Resources のキーの数そのもの", () => {
        expect(countResources(template(7))).toBe(7);
    });

    it("Resources が無い・形が違うテンプレートは 0 個と数えずに投げる", () => {
        expect(() => countResources({})).toThrow();
        expect(() => countResources(null)).toThrow();
        expect(() => countResources({ Resources: [] })).toThrow();
    });

    it("種類ごとの内訳は多い順", () => {
        expect(typeBreakdown(template(7))).toEqual([
            { type: "AWS::Lambda::Function", count: 3 },
            { type: "AWS::ApiGatewayV2::Route", count: 2 },
            { type: "AWS::Logs::LogGroup", count: 2 },
        ]);
        expect(typeBreakdown(template(7), 1)).toEqual([{ type: "AWS::Lambda::Function", count: 3 }]);
    });

    describe("すでに 450 を超えているスタック（FROZEN_AT）は増えたら落ちる", () => {
        it("載せた数と同じ・減ったなら通す（frozen）、1つでも増えたら落ちる", () => {
            expect(judge(488, { frozenAt: 488 })).toBe("frozen");
            expect(judge(470, { frozenAt: 488 })).toBe("frozen");
            expect(judge(489, { frozenAt: 488 })).toBe("fail");
        });
        it("450 以下に下がれば、表に載っていても普通の判定", () => {
            expect(judge(449, { frozenAt: 488 })).toBe("warn");
        });
        it("載せた数が上限 500 以上なら表が壊れているので通さない", () => {
            expect(judge(499, { frozenAt: 500 })).toBe("fail");
        });
        it("表の数は 450 を超え 500 未満（上げて逃がしていない）", () => {
            for (const [name, n] of Object.entries(FROZEN_AT)) {
                expect(n, name).toBeGreaterThan(FAIL_ABOVE);
                expect(n, name).toBeLessThanOrEqual(488);
            }
        });
    });

    it("既定値の無い ${param:…} だけを拾う", () => {
        const text = [
            "a: ${param:photosTable}",
            "b: ${param:photosTable}",
            "c: ${param:apnsHost, ''}",
            "d: ${param:musicSearchReserved, null}",
            "e: arn:aws:s3:::${param:uploadBucket}/x",
        ].join("\n");
        expect(requiredParams(text)).toEqual(["photosTable", "uploadBucket"]);
    });

    it("${aws:accountId} だけを仮の 12 桁に置き換える", () => {
        const out = substituteAccountId("arn:aws:dynamodb:${aws:region}:${aws:accountId}:table/${aws:accountId}");
        expect(out).toBe("arn:aws:dynamodb:${aws:region}:000000000000:table/000000000000");
    });

    it("serverless の設定ファイルを全部拾い、写しやほかの yml は拾わない", () => {
        expect(serverlessConfigNames([
            "serverless.yml", "serverless.spot-wants.yml", "serverless.qr.yml", "serverless.trip-share.yaml",
            ".stack-size-check-serverless.yml", "package.json", "other.yml", "serverless.yml.bak",
        ])).toEqual(["serverless.qr.yml", "serverless.spot-wants.yml", "serverless.trip-share.yaml", "serverless.yml"]);
    });

    it("まとめの表に設定・stage・数・判定が出る", () => {
        const md = summaryMarkdown([{
            service: "api-user/serverless.yml", stage: "prod", count: 488, level: "frozen",
            top: [{ type: "AWS::ApiGatewayV2::Route", count: 116 }],
        }]);
        expect(md).toContain("| api-user/serverless.yml | prod | 488 | ⚠️ 増やせない | ApiGatewayV2::Route 116 |");
    });
});

describe("検査がワークフローに入っている", () => {
    const wf = (f: string) => readFileSync(join(__dirname, "..", "..", ".github", "workflows", f), "utf8");

    it("PR の検証（stack-size.yml）が api/ api-user/ の PR で流れる", () => {
        const y = wf("stack-size.yml");
        expect(y).toMatch(/pull_request:/);
        expect(y).toContain('"api/**"');
        expect(y).toContain('"api-user/**"');
        expect(y).toContain("node scripts/check-stack-size.mjs");
    });

    it("deploy-api.yml は配るジョブより前（config）で数える", () => {
        const y = wf("deploy-api.yml");
        const config = y.indexOf("\n  config:\n");
        const check = y.indexOf("node scripts/check-stack-size.mjs");
        const firstDeploy = y.indexOf("\n  deploy-admin-api:\n");
        expect(config).toBeGreaterThan(0);
        expect(check).toBeGreaterThan(config);
        expect(check).toBeLessThan(firstDeploy);
    });
});
