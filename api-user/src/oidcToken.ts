/**
 * 外のアカウントの ID トークン（JWT・RS256）を、提供元の公開鍵（JWKS）で確かめる共通の部品
 * （Apple・札 journey.photo-ios#601 と Google・#715）。部品を足さない（`node:crypto` だけ）。
 *
 * 提供元ごとに違うのは「鍵の置き場」「発行元（`iss`）」「中身の読み方」だけで、それは呼ぶ側
 * （`appleIdToken.ts`・`googleIdToken.ts`）が持つ。
 */
import { createPublicKey, verify } from "node:crypto";

/** ID トークンの長さの上限。実物は 1〜2KB。これを超えるものは読まずに断る（ログイン不要の口で重い処理をさせない） */
export const MAX_TOKEN_LENGTH = 4096;
/** 時計のずれの許し（秒） */
export const CLOCK_SKEW_SEC = 60;
/** 公開鍵の控えの寿命。提供元は鍵を入れ替えるので、知らない kid が来たら取り直す */
const KEYS_TTL_MS = 60 * 60 * 1000;
/**
 * 取り直しの間（ミリ秒）。**知らない kid の token を送り続けて、提供元への問い合わせを起こさせない**
 * （ログイン不要の口・2026-11-23 確かめ役の指摘）。取り直してから 60 秒は、知らない kid は控えだけで断る
 */
export const KEYS_REFETCH_MIN_MS = 60 * 1000;
/** 提供元に問い合わせるときの待ちの上限 */
export const PROVIDER_TIMEOUT_MS = 5000;

/** fetch の口（試験で差し替える） */
export type FetchLike = (url: string, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export const defaultFetch: FetchLike = (url, init) => fetch(url, init);

type Jwk = { kty: string; kid: string; alg?: string; use?: string; n: string; e: string };

function isRsaJwk(k: unknown): k is Jwk {
    const j = k as Partial<Jwk> | null;
    return !!j && j.kty === "RSA" && typeof j.kid === "string" && typeof j.n === "string" && typeof j.e === "string";
}

/** 提供元1つぶんの公開鍵の控え */
export class KeyStore {
    private cache: { at: number; keys: Jwk[] } | null = null;
    /** 最後に取りに行った時刻（失敗した回も数える。提供元が落ちているときに叩き続けない） */
    private lastFetchAt = -Infinity;
    /** 取りに行っている途中の回（同時に来た回はこれを待つ。待たずに断ると、起動直後の同時のサインインが落ちる） */
    private inflight: Promise<Jwk[]> | null = null;

    constructor(private readonly url: string, private readonly fail: (reason: string) => Error) {}

    reset(): void {
        this.cache = null;
        this.lastFetchAt = -Infinity;
        this.inflight = null;
    }

    private async fetchKeys(fetchImpl: FetchLike): Promise<Jwk[]> {
        const res = await fetchImpl(this.url, { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
        if (!res.ok) throw this.fail(`keys http ${res.status}`);
        const body = await res.json() as { keys?: unknown };
        const keys = Array.isArray(body.keys) ? body.keys.filter(isRsaJwk) : [];
        if (keys.length === 0) throw this.fail("keys empty");
        return keys;
    }

    /** kid の鍵を返す。控えに無ければ取り直す（鍵の入れ替え）。ただし取り直しは 60 秒に1回まで */
    async jwk(kid: string, fetchImpl: FetchLike, now: number): Promise<Jwk | undefined> {
        if (this.cache && now - this.cache.at < KEYS_TTL_MS) {
            const hit = this.cache.keys.find((k) => k.kid === kid);
            if (hit) return hit;
        }
        if (this.inflight) return (await this.inflight).find((k) => k.kid === kid);
        if (now - this.lastFetchAt < KEYS_REFETCH_MIN_MS) {
            // 取り直したばかり。控えが古くても、控えにある鍵なら使う（鍵の入れ替えは日単位）
            return this.cache?.keys.find((k) => k.kid === kid);
        }
        this.lastFetchAt = now;
        this.inflight = this.fetchKeys(fetchImpl);
        try {
            const keys = await this.inflight;
            this.cache = { at: now, keys };
            return keys.find((k) => k.kid === kid);
        } finally {
            this.inflight = null;
        }
    }
}

/**
 * RS256 の ID トークンを確かめ、中身を返す。署名（提供元の公開鍵）・発行元・宛先・期限・発行の時刻・`sub` を見る。
 * どれかが合わなければ `fail(理由)` を投げる。提供元に固有の項目（メール・nonce）は呼ぶ側が読む
 */
export async function verifyRs256IdToken(
    token: unknown,
    opts: {
        keys: KeyStore; issuers: readonly string[]; clientIds: readonly string[];
        fail: (reason: string) => Error; now?: number; fetchImpl?: FetchLike;
    },
): Promise<Record<string, unknown> & { sub: string; aud: string; iat: number; exp: number }> {
    const { fail } = opts;
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw fail("shape");
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw fail("shape");
    const [h, p, s] = parts;
    const json = (part: string): Record<string, unknown> => {
        try {
            const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
            if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
        } catch { /* 下で断る */ }
        throw fail("malformed");
    };
    const header = json(h);
    // **RS256 だけ。** "none" や HS256（公開鍵を共有の秘密として使わせる）を受けない
    if (header.alg !== "RS256" || typeof header.kid !== "string") throw fail("alg");

    const now = opts.now ?? Date.now();
    const jwk = await opts.keys.jwk(header.kid, opts.fetchImpl ?? defaultFetch, now);
    if (!jwk) throw fail("unknown kid");
    const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: "jwk" });
    if (!verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))) throw fail("signature");

    const c = json(p);
    if (typeof c.iss !== "string" || !opts.issuers.includes(c.iss)) throw fail("iss");
    // 宛先は1つの文字列だけ受ける（配列の aud は使っていない提供元なので断る）
    if (typeof c.aud !== "string" || !opts.clientIds.includes(c.aud)) throw fail("aud");
    const nowSec = Math.floor(now / 1000);
    if (typeof c.exp !== "number" || c.exp + CLOCK_SKEW_SEC < nowSec) throw fail("expired");
    if (typeof c.iat !== "number" || c.iat - CLOCK_SKEW_SEC > nowSec) throw fail("iat");
    if (typeof c.sub !== "string" || !c.sub || c.sub.length > 255) throw fail("sub");
    return c as Record<string, unknown> & { sub: string; aud: string; iat: number; exp: number };
}

/** 真偽は `true` と `"true"` の両方で来る */
export function truthy(v: unknown): boolean {
    return v === true || v === "true";
}
