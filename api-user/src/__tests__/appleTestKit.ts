/**
 * 「Apple でサインイン」の試験の道具（札 journey.photo-ios#601）。
 * Apple の代わりの鍵で identity token を作り、Apple の公開鍵の口（JWKS）の代わりを返す。
 * 本物の Apple には話しかけない
 */
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import type { FetchLike } from "../appleIdToken";

export const CLIENT_ID = "com.journeyphoto.JourneyPhoto";
export const KID = "TESTKID1";

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
/** Apple の鍵の代わり */
export const applePrivate: KeyObject = rsa.privateKey;
/** 別の鍵（署名が合わないことを見る） */
export const otherPrivate: KeyObject = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

export const jwks = () => ({ keys: [{ ...rsa.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] });

/** .p8 の代わり（ES256・P-256） */
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const p8Pem = ec.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
export const p8Public: KeyObject = ec.publicKey;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

export function makeToken(
    claims: Record<string, unknown> = {},
    opts: { key?: KeyObject; header?: Record<string, unknown>; nowSec?: number } = {},
): string {
    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    const head = b64({ alg: "RS256", kid: KID, ...opts.header });
    const body = b64({
        iss: "https://appleid.apple.com", aud: CLIENT_ID, sub: "001234.apple", iat: now, exp: now + 600,
        nonce: "n0nce", email: "taro@example.com", email_verified: "true", ...claims,
    });
    const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), opts.key ?? applePrivate).toString("base64url");
    return `${head}.${body}.${sig}`;
}

export type Call = { url: string; body?: string };

/** Apple の口の代わり。鍵の一覧・トークン・取り消しを返し、呼ばれた中身を残す */
export function fakeApple(opts: { tokenStatus?: number; revokeStatus?: number; refreshToken?: string; keys?: () => unknown } = {}) {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        calls.push({ url, body: init?.body });
        const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
        if (url.endsWith("/auth/keys")) return reply(200, (opts.keys ?? jwks)());
        if (url.endsWith("/auth/token")) return reply(opts.tokenStatus ?? 200, { refresh_token: opts.refreshToken ?? "r.apple.1", id_token: "x" });
        if (url.endsWith("/auth/revoke")) return reply(opts.revokeStatus ?? 200, {});
        return reply(404, {});
    };
    return { fetchImpl, calls };
}
