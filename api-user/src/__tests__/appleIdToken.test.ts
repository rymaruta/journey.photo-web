import { describe, it, expect, beforeEach } from "vitest";
import { verify } from "node:crypto";
import {
    verifyAppleIdentityToken, resetAppleKeysCache, appleConfigFromEnv, appleClientIdsFromEnv, appleClientSecret,
    exchangeAppleCode, revokeAppleToken, AppleTokenError, MAX_TOKEN_LENGTH, KEYS_REFETCH_MIN_MS,
    loadAppleConfig, appleKeyDeps, resetAppleKeyConfigCache,
} from "../appleIdToken";
import { CLIENT_ID, fakeApple, jwks, makeToken, otherPrivate, p8Pem, p8Public } from "./appleTestKit";

/**
 * 「Apple でサインイン」の Apple の鍵の確かめ（札 journey.photo-ios#601）。
 * 🔴 ここが通すものは、そのまま Cognito のログインになる。落とすべきものを1つずつ見る
 */
const verifyWith = (token: unknown, fetchImpl = fakeApple().fetchImpl) =>
    verifyAppleIdentityToken(token, { clientIds: [CLIENT_ID], fetchImpl });

const reason = async (p: Promise<unknown>) => {
    try {
        await p;
        return "通った";
    } catch (e) {
        expect(e).toBeInstanceOf(AppleTokenError);
        return (e as AppleTokenError).reason;
    }
};

beforeEach(() => {
    resetAppleKeysCache();
    resetAppleKeyConfigCache();
});

describe("identity token の確かめ", () => {
    it("Apple の鍵で署名された、このアプリあての token を通し、中身を読む", async () => {
        const c = await verifyWith(makeToken({ is_private_email: "true", email: "x@privaterelay.appleid.com" }));
        expect(c.sub).toBe("001234.apple");
        expect(c.aud).toBe(CLIENT_ID);
        expect(c.email).toBe("x@privaterelay.appleid.com");
        expect(c.emailVerified).toBe(true);
        expect(c.isPrivateEmail).toBe(true);
        expect(c.nonce).toBe("n0nce");
    });

    it("真偽は true と \"true\" の両方を読む。メールが無ければ確かめ済みにしない", async () => {
        expect((await verifyWith(makeToken({ email_verified: true }))).emailVerified).toBe(true);
        expect((await verifyWith(makeToken({ email_verified: "false" }))).emailVerified).toBe(false);
        const none = await verifyWith(makeToken({ email: undefined, email_verified: "true" }));
        expect(none.email).toBeUndefined();
        expect(none.emailVerified).toBe(false);
    });

    it("別の鍵の署名は落とす", async () => {
        expect(await reason(verifyWith(makeToken({}, { key: otherPrivate })))).toBe("signature");
    });

    it("中身を書き換えたものは落とす（署名が合わない）", async () => {
        const [h, , s] = makeToken().split(".");
        const forged = Buffer.from(JSON.stringify({ iss: "https://appleid.apple.com", aud: CLIENT_ID, sub: "someone.else", iat: 1, exp: 9e9 })).toString("base64url");
        expect(await reason(verifyWith(`${h}.${forged}.${s}`))).toBe("signature");
    });

    it("別のアプリあて・別の発行元・期限切れ・未来の発行は落とす", async () => {
        expect(await reason(verifyWith(makeToken({ aud: "com.example.other" })))).toBe("aud");
        expect(await reason(verifyWith(makeToken({ iss: "https://evil.example" })))).toBe("iss");
        const old = Math.floor(Date.now() / 1000) - 3600;
        expect(await reason(verifyWith(makeToken({ iat: old - 600, exp: old })))).toBe("expired");
        const future = Math.floor(Date.now() / 1000) + 3600;
        expect(await reason(verifyWith(makeToken({ iat: future, exp: future + 600 })))).toBe("iat");
    });

    it("RS256 以外（none・HS256）は鍵を見る前に落とす", async () => {
        const apple = fakeApple();
        expect(await reason(verifyWith(makeToken({}, { header: { alg: "none" } }), apple.fetchImpl))).toBe("alg");
        expect(await reason(verifyWith(makeToken({}, { header: { alg: "HS256" } }), apple.fetchImpl))).toBe("alg");
        expect(apple.calls).toHaveLength(0);
    });

    it("形の壊れたもの・長すぎるもの・文字列でないものは Apple に問い合わせずに落とす", async () => {
        const apple = fakeApple();
        for (const bad of ["", "a.b", "a.b.c.d", "a.b.c!", 42, null, "x".repeat(MAX_TOKEN_LENGTH + 1)]) {
            expect(await reason(verifyWith(bad, apple.fetchImpl)), String(bad).slice(0, 10)).toBe("shape");
        }
        expect(apple.calls).toHaveLength(0);
    });

    it("知らない kid は鍵を取り直す（Apple の鍵の入れ替え）。それでも無ければ落とす", async () => {
        let round = 0;
        const apple = fakeApple({ keys: () => (++round === 1 ? { keys: [{ ...jwks().keys[0], kid: "OLD" }] } : jwks()) });
        const t0 = Date.now();
        const at = (token: string, now: number) => verifyAppleIdentityToken(token, { clientIds: [CLIENT_ID], fetchImpl: apple.fetchImpl, now });
        await at(makeToken({}, { header: { kid: "OLD" } }), t0).catch(() => undefined);
        // 控えには OLD しか無い。60 秒たてば、新しい kid の token で取り直して通る
        await expect(at(makeToken(), t0 + KEYS_REFETCH_MIN_MS)).resolves.toMatchObject({ sub: "001234.apple" });
        expect(apple.calls.filter((c) => c.url.endsWith("/auth/keys"))).toHaveLength(2);
        expect(await reason(at(makeToken({}, { header: { kid: "NOPE" } }), t0 + 3 * KEYS_REFETCH_MIN_MS))).toBe("unknown kid");
    });

    it("🔴 知らない kid を送り続けても、Apple への取り直しは 60 秒に1回まで", async () => {
        const apple = fakeApple();
        const t0 = Date.now();
        const at = (now: number) => verifyAppleIdentityToken(makeToken({}, { header: { kid: "NOPE" } }),
            { clientIds: [CLIENT_ID], fetchImpl: apple.fetchImpl, now });
        for (let i = 0; i < 20; i++) expect(await reason(at(t0 + i * 1000))).toBe("unknown kid");
        const fetches = () => apple.calls.filter((c) => c.url.endsWith("/auth/keys")).length;
        expect(fetches()).toBe(1);
        // 60 秒たったら、もう1回だけ取りに行く
        await reason(at(t0 + KEYS_REFETCH_MIN_MS));
        expect(fetches()).toBe(2);
        // 控えにある鍵は、取り直しを待たずに使える
        await expect(verifyAppleIdentityToken(makeToken(), { clientIds: [CLIENT_ID], fetchImpl: apple.fetchImpl, now: t0 + KEYS_REFETCH_MIN_MS + 1 }))
            .resolves.toMatchObject({ sub: "001234.apple" });
        expect(fetches()).toBe(2);
    });

    it("起動直後に同時に来ても、鍵の取りに行きを待って両方通る（取りに行くのは1回）", async () => {
        const apple = fakeApple();
        const results = await Promise.all([1, 2, 3].map(() => verifyWith(makeToken(), apple.fetchImpl)));
        expect(results.map((r) => r.sub)).toEqual(["001234.apple", "001234.apple", "001234.apple"]);
        expect(apple.calls.filter((c) => c.url.endsWith("/auth/keys"))).toHaveLength(1);
    });

    it("鍵は控えて使い回す（ログインのたびに Apple に問い合わせない）", async () => {
        const apple = fakeApple();
        await verifyWith(makeToken(), apple.fetchImpl);
        await verifyWith(makeToken(), apple.fetchImpl);
        expect(apple.calls.filter((c) => c.url.endsWith("/auth/keys"))).toHaveLength(1);
    });
});

describe("鍵の設定（2026-11-23 owner: 鍵は APNs の鍵を使う）", () => {
    const full = {
        APPLE_SIGNIN_CLIENT_ID: CLIENT_ID, APNS_TEAM_ID: "TEAM123456", APNS_KEY_ID: "DDYJB5893J",
        APNS_PRIVATE_KEY: p8Pem.replace(/\n/g, "\\n"),
    };

    it("APNs の鍵・Key ID・Team ID と宛先がそろえば使える。鍵の改行（\\n で渡す）を戻す", () => {
        const cfg = appleConfigFromEnv(full);
        expect(cfg).toMatchObject({ clientId: CLIENT_ID, teamId: "TEAM123456", keyId: "DDYJB5893J" });
        expect(cfg!.privateKey).toContain("\n");
        expect(cfg!.privateKey).not.toContain("\\n");
    });

    it("鍵が無い・どれか1つでも欠けていれば使えない（口は 503、アプリはボタンを出さない）", () => {
        expect(appleConfigFromEnv({})).toBeNull();
        for (const k of Object.keys(full)) {
            expect(appleConfigFromEnv({ ...full, [k]: "" }), k).toBeNull();
        }
        expect(appleConfigFromEnv({ ...full, APNS_PRIVATE_KEY: "-----BEGIN" })).toBeNull();
        expect(appleConfigFromEnv({ ...full, APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nxx\\n-----END PRIVATE KEY-----" })).toBeNull();
        // 前の名前（専用の鍵）は読まない
        expect(appleConfigFromEnv({ APPLE_SIGNIN_CLIENT_ID: CLIENT_ID, APPLE_SIGNIN_TEAM_ID: "T", APPLE_SIGNIN_KEY_ID: "K", APPLE_SIGNIN_PRIVATE_KEY: p8Pem })).toBeNull();
    });

    it("宛先は鍵が無くても読める（トリガーは鍵を持たない）", () => {
        expect(appleClientIdsFromEnv({ APPLE_SIGNIN_CLIENT_ID: CLIENT_ID })).toEqual([CLIENT_ID]);
        expect(appleClientIdsFromEnv({})).toEqual([]);
    });

    it("SSM の SecureString の名前があれば、鍵は実行時にそこから読む（環境変数の鍵は使わない）。控えは5分", async () => {
        const reads: string[] = [];
        appleKeyDeps.getParameter = async (name) => { reads.push(name); return p8Pem; };
        const env = { ...full, APNS_PRIVATE_KEY: "", APPLE_SIGNIN_KEY_PARAM: "/journey-photo/prod/apple-signin/private-key" };
        const t0 = Date.now();
        expect(await loadAppleConfig(env, t0)).toMatchObject({ keyId: "DDYJB5893J", privateKey: p8Pem.trim() });
        expect(await loadAppleConfig(env, t0 + 60_000)).not.toBeNull();
        expect(reads).toEqual(["/journey-photo/prod/apple-signin/private-key"]);
        await loadAppleConfig(env, t0 + 5 * 60_000);
        expect(reads).toHaveLength(2);
    });

    it("SSM を読めない・鍵として読めないなら使えない（投げない）", async () => {
        appleKeyDeps.getParameter = async () => { throw Object.assign(new Error("x"), { name: "ParameterNotFound" }); };
        const env = { ...full, APPLE_SIGNIN_KEY_PARAM: "/x" };
        expect(await loadAppleConfig(env)).toBeNull();
        resetAppleKeyConfigCache();
        appleKeyDeps.getParameter = async () => "not a key";
        expect(await loadAppleConfig(env)).toBeNull();
    });

    it("SSM の名前が無ければ環境変数の鍵", async () => {
        expect(await loadAppleConfig(full)).not.toBeNull();
    });
});

describe("Apple の client secret とトークンの口", () => {
    const cfg = { clientId: CLIENT_ID, teamId: "TEAM123456", keyId: "KEY1234567", privateKey: p8Pem };

    it("ES256 で署名し、Apple の決まりの項目を持つ（5分で切れる）", () => {
        const now = Date.UTC(2026, 10, 23);
        const jwt = appleClientSecret(cfg, now);
        const [h, b, s] = jwt.split(".");
        expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
        const body = JSON.parse(Buffer.from(b, "base64url").toString());
        expect(body).toEqual({ iss: "TEAM123456", iat: now / 1000, exp: now / 1000 + 300, aud: "https://appleid.apple.com", sub: CLIENT_ID });
        expect(verify("sha256", Buffer.from(`${h}.${b}`), { key: p8Public, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
    });

    it("認可コードを更新トークンに替える。失敗なら undefined（ログインは止めない）", async () => {
        const apple = fakeApple({ refreshToken: "r.1" });
        expect(await exchangeAppleCode(cfg, "code-1", apple.fetchImpl)).toBe("r.1");
        const sent = new URLSearchParams(apple.calls[0].body);
        expect(sent.get("grant_type")).toBe("authorization_code");
        expect(sent.get("code")).toBe("code-1");
        expect(sent.get("client_id")).toBe(CLIENT_ID);
        expect(sent.get("client_secret")?.split(".")).toHaveLength(3);
        expect(await exchangeAppleCode(cfg, "code-1", fakeApple({ tokenStatus: 400 }).fetchImpl)).toBeUndefined();
    });

    it("取り消しは更新トークンとして送る。失敗なら false", async () => {
        const apple = fakeApple();
        expect(await revokeAppleToken(cfg, "r.1", apple.fetchImpl)).toEqual({ ok: true, status: 200 });
        const sent = new URLSearchParams(apple.calls[0].body);
        expect(apple.calls[0].url).toBe("https://appleid.apple.com/auth/revoke");
        expect(sent.get("token")).toBe("r.1");
        expect(sent.get("token_type_hint")).toBe("refresh_token");
        expect(await revokeAppleToken(cfg, "r.1", fakeApple({ revokeStatus: 500 }).fetchImpl)).toEqual({ ok: false, status: 500 });
    });
});
