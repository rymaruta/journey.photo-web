#!/usr/bin/env node
/**
 * 「Apple でサインイン」の鍵を SSM パラメータストアの SecureString に置く（札 journey.photo-ios#601）。
 *
 * サーバーは鍵を `/journey-photo/<環境>/apple-signin/private-key` から実行時に読む（`deploy-api.yml` の
 * `APPLE_SIGNIN_KEY_SOURCE: ssm`・`api-user/src/appleIdToken.ts`）。鍵はプッシュ通知の鍵（Key ID DDYJB5893J）に
 * Sign in with Apple を足したもの（2026-11-23 owner）で、中身は Secrets の `APNS_PRIVATE_KEY` と同じ。
 * そこで、owner が .p8 を手で貼る代わりに、**Secrets の中身をそのまま SSM に写す**。
 *
 * 🔴 **鍵の中身はどこにも出さない。** 出すのは長さ・形（EC の P-256 か）・公開鍵の指紋（公開鍵の SHA-256 の頭。
 *    公開の値）と、SSM に今あるものと同じかどうかだけ。コマンドラインにも載せない（SDK で送る）。
 *
 *   APNS_PRIVATE_KEY=... STAGE=staging node scripts/apple-signin-key-to-ssm.js           # 読むだけ
 *   APNS_PRIVATE_KEY=... STAGE=staging node scripts/apple-signin-key-to-ssm.js --apply   # 置く（同じなら何もしない）
 *
 * 費用: SSM の標準のパラメータは無料。暗号の鍵は AWS が持つ既定の `aws/ssm`（無料）。
 */
const crypto = require("node:crypto");
const { SSMClient, GetParameterCommand, PutParameterCommand } = require("@aws-sdk/client-ssm");
const { requireEnv } = require("./lib/env");
const { assertStage, keyParamForStage } = require("./lib/signinStage");

/**
 * Secrets の値を PEM に整える（純関数）。CR を落とし、1行にした形（`\n` の2文字）も戻す
 * （`appleIdToken.ts` の読み方と同じ）。EC の P-256 の秘密鍵でなければ止める（Apple の鍵は必ずこの形）。
 *
 * @returns {{ pem: string, info: { length: number, lines: number, curve: string, publicFingerprint: string } }}
 */
function normalizePem(raw) {
    const pem = String(raw ?? "").replace(/\r/g, "").replace(/\\n/g, "\n").trim();
    if (pem.length < 200 || !pem.includes("-----BEGIN PRIVATE KEY-----") || !pem.includes("-----END PRIVATE KEY-----")) {
        throw new Error("鍵（secrets.APNS_PRIVATE_KEY）の形が違います（200 文字未満か、BEGIN PRIVATE KEY と END PRIVATE KEY の両方がない）");
    }
    let key;
    try {
        key = crypto.createPrivateKey({ key: pem, format: "pem" });
    } catch {
        throw new Error("鍵（secrets.APNS_PRIVATE_KEY）を秘密鍵として読めません");
    }
    const curve = key.asymmetricKeyDetails?.namedCurve ?? "";
    if (key.asymmetricKeyType !== "ec" || curve !== "prime256v1") {
        throw new Error(`鍵が Apple の形（EC の P-256）ではありません（${key.asymmetricKeyType} ${curve}）`);
    }
    const spki = crypto.createPublicKey(key).export({ format: "der", type: "spki" });
    const publicFingerprint = crypto.createHash("sha256").update(spki).digest("hex").slice(0, 16);
    return { pem, info: { length: pem.length, lines: pem.split("\n").length, curve, publicFingerprint } };
}

/** 何をするか（純関数）。比べるのは中身の SHA-256 だけ */
function planPut({ existingSha, newSha }) {
    if (!existingSha) return "create";
    return existingSha === newSha ? "none" : "overwrite";
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function main() {
    const apply = process.argv.includes("--apply");
    const stage = assertStage(requireEnv("STAGE", "prod か staging"));
    const raw = requireEnv("APNS_PRIVATE_KEY", "Secrets の APNS_PRIVATE_KEY をステップの env で渡す");
    const name = keyParamForStage(stage);
    const ssm = new SSMClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });

    const { pem, info } = normalizePem(raw);
    console.log(`[key] ${stage} 置き場 ${name}`);
    console.log(`[key] 写す鍵: ${info.length} 文字・${info.lines} 行・EC ${info.curve}・公開鍵の指紋 ${info.publicFingerprint}`);

    let existing = null;
    try {
        const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
        existing = res.Parameter ?? null;
    } catch (e) {
        if (e.name !== "ParameterNotFound") throw e;
    }
    if (existing && existing.Type !== "SecureString") {
        throw new Error(`${name} は SecureString ではありません（${existing.Type}）。手で消してから流し直してください`);
    }
    let existingFingerprint = "";
    if (existing) {
        try { existingFingerprint = normalizePem(existing.Value).info.publicFingerprint; } catch { existingFingerprint = "（鍵として読めない）"; }
    }
    const plan = planPut({ existingSha: existing ? sha256(String(existing.Value).replace(/\r/g, "").trim()) : "", newSha: sha256(pem) });
    console.log(`[key] いま SSM にあるもの: ${existing ? `版 ${existing.Version}・公開鍵の指紋 ${existingFingerprint}` : "無い"}`);
    console.log(`[key] する事: ${{ create: "新しく作る", overwrite: "上書きする（中身が違う）", none: "何もしない（同じ中身がある）" }[plan]}`);
    if (plan === "none") return;
    if (!apply) {
        console.log("[key] 読むだけで終わります。置くときは apply を true にして流してください");
        return;
    }

    await ssm.send(new PutParameterCommand({
        Name: name,
        Value: pem,
        Type: "SecureString",
        Tier: "Standard",
        Overwrite: plan === "overwrite",
        Description: "Apple でサインインの鍵（APNs の鍵 DDYJB5893J と同じ・Maintenance の apple-signin-key で置いた）",
    }));
    const back = (await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))).Parameter;
    if (!back || sha256(String(back.Value).trim()) !== sha256(pem)) throw new Error("置いたあと読み直した中身が違います");
    console.log(`[key] 置きました（版 ${back.Version}）。読み直して同じ中身なのを確かめました`);
}

if (require.main === module) {
    main().catch((e) => {
        console.error(`::error::${e.message}`);
        process.exit(1);
    });
}

module.exports = { normalizePem, planPut };
