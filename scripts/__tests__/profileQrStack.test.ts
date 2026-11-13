import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * プロフィールの QR の口（札 journey.photo-ios#545・2026-11-12）は **user API とは別のスタック**
 * （`api-user/serverless.profile-qr.yml`）に置いた。user API のスタックは部品が 488/500 で、
 * 足すと CloudFormation の上限で本番の反映が落ちる（2026-11-12 に 503 個で落ちた）。
 *
 * ここで固定すること:
 *   - user API の設定に QR の口が戻ってこない（部品を増やさない）
 *   - 別スタックは新しい HTTP API を作らず、user API の HttpApiId を取り込んで経路だけ足す
 *   - 本人の口はログインの確かめ（このスタックの JWT の確かめ）を通り、退会した本人を塞ぐ
 *   - ログイン不要の口は読み取り専用の役割（`qr#` の GetItem だけ）
 *   - 反映の手順が別スタックを配る
 *
 * YAML パーサは使わない（`publicLambdaRole.test.ts` と同じ理由）。
 */
const ROOT = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const QR_YML = read("api-user/serverless.profile-qr.yml");
const USER_YML = read("api-user/serverless.yml");
const DEPLOY = read(".github/workflows/deploy-api.yml");
const SRC = read("api-user/src/profileQr.ts");

/** 2スペース字下げの関数のブロック（コメント行を除く） */
function fnBlock(yml: string, name: string): string {
    const body = yml.split(/\nfunctions:\n/)[1]?.split(/\n(?=[a-zA-Z#])/)[0] ?? "";
    const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|$)`).exec("\n" + body);
    if (!m) throw new Error(`${name} が無い`);
    return m[1].replace(/^\s*#.*$/gm, "");
}

/** resources の中の1つの部品（4スペース字下げ） */
function resourceBlock(yml: string, name: string): string {
    const m = new RegExp(`\\n    ${name}:\\n([\\s\\S]*?)(?=\\n    \\w+:\\n|$)`).exec(yml);
    if (!m) throw new Error(`${name} が無い`);
    return m[1].replace(/^\s*#.*$/gm, "");
}

describe("プロフィールの QR の別スタック", () => {
    it("user API の設定には QR の口を置かない", () => {
        expect(USER_YML).not.toMatch(/profileQr\./);
        expect(USER_YML).not.toMatch(/path:\s*\/(user\/)?qr/);
    });

    it("新しい HTTP API を作らず、user API の HttpApiId を取り込む", () => {
        const provider = QR_YML.split(/\nfunctions:\n/)[0];
        expect(provider).toMatch(/httpApi:\n\s+#[^\n]*\n\s+id:\n\s+Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-HttpApiId/);
        expect(provider).not.toMatch(/\n\s+cors:/);
        expect(provider).not.toMatch(/authorizers:/);
    });

    it("本人の口2つは user API が書き出す JWT の確かめを通る（自分で認可を作らない・#552 ③）", () => {
        for (const fn of ["getMyQr", "rotateMyQr"]) {
            const b = fnBlock(QR_YML, fn);
            expect(b).toMatch(/authorizer:\n\s+type: jwt\n\s+id:\n\s+Fn::ImportValue: sls-photo-gallery-user-api-\$\{sls:stage\}-CognitoAuthorizerId/);
            expect(b).toMatch(/role: QrOwnerRole/);
        }
        expect(QR_YML).not.toMatch(/AWS::ApiGatewayV2::Authorizer/);
    });

    it("本人の口は退会した本人を塞ぐ（書く口なので `assertLiveCaller`）", () => {
        for (const fn of ["getMyQr", "rotateMyQr"]) {
            const m = new RegExp(`export const ${fn}[\\s\\S]*?\\n};`).exec(SRC);
            expect(m?.[0]).toMatch(/await assertLiveCaller\(userId\)/);
        }
    });

    it("ログイン不要の口は読み取り専用の役割で、qr# の GetItem だけ", () => {
        const b = fnBlock(QR_YML, "resolveQr");
        expect(b).not.toMatch(/authorizer:/);
        expect(b).toMatch(/role: QrPublicRole/);
        const role = resourceBlock(QR_YML, "QrPublicRole");
        const actions = [...role.matchAll(/- (dynamodb:\w+)/g)].map((m) => m[1]);
        expect(actions).toEqual(["dynamodb:GetItem"]);
        expect(role).toMatch(/dynamodb:LeadingKeys:\n\s+- qr#\*\s*$/);
        expect(role).not.toMatch(/\/index\//);
    });

    it("本人の役割は QR の2種類の行だけを読み書きする（写真の行・索引には触れない）", () => {
        const role = resourceBlock(QR_YML, "QrOwnerRole");
        expect(role).toMatch(/dynamodb:LeadingKeys:\n\s+- qr#\*\n\s+- qrof#\*/);
        expect(role).not.toMatch(/dynamodb:(Query|Scan|UpdateItem|BatchWriteItem)/);
        expect(role).not.toMatch(/\/index\//);
    });

    it("どの関数も自分の役割を持つ（serverless の共有の役割を作らない）", () => {
        const body = QR_YML.split(/\nfunctions:\n/)[1].split(/\n(?=[a-zA-Z#])/)[0];
        const names = [...("\n" + body).matchAll(/\n  (\w+):\n/g)].map((m) => m[1]);
        expect(names.sort()).toEqual(["getMyQr", "resolveQr", "rotateMyQr"]);
        for (const n of names) expect(fnBlock(QR_YML, n)).toMatch(/\n\s+role: Qr\w+Role/);
    });

    it("反映の手順が別スタックを、要る値を渡して配る", () => {
        const m = /- name: Serverless deploy（プロフィールの QR・別スタック）[\s\S]*?--param "usersTable=[^\n]*/.exec(DEPLOY);
        expect(m).not.toBeNull();
        const step = m![0];
        expect(step).toMatch(/working-directory: api-user/);
        expect(step).toMatch(/--config serverless\.profile-qr\.yml/);
        // 認可は user API が書き出すものを取り込むので、Cognito の値は渡さない（#552 ③）
        for (const p of ["photosTable", "usersTable"]) {
            expect(step).toContain(`--param "${p}=`);
            expect(QR_YML).toContain(`\${param:${p}}`);
        }
        // user API の後（取り込む HttpApiId を書き出すのは user API のスタック）
        expect(DEPLOY.indexOf("Serverless deploy（プロフィールの QR")).toBeGreaterThan(DEPLOY.indexOf("npx serverless@3 deploy --stage"));
    });
});
