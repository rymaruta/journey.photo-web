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

// ────────────────────────────── users 表の代わり

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
type Input = Record<string, any>;

export function conditionFailed(): Error {
    return Object.assign(new Error("cc"), { name: "ConditionalCheckFailedException" });
}

/**
 * DynamoDB の条件式を、使う分だけ評価する（`attribute_exists`・`attribute_not_exists`・`=`・`<>`・`<`・AND・OR・括弧）。
 * 🔴 条件を真似ずに常に通すと、「1回きり」「上書きしない」を確かめたつもりで何も見ていない試験になる
 */
export function evalCondition(expr: string | undefined, row: Row | undefined, names: Input = {}, values: Input = {}): boolean {
    if (!expr) return true;
    const tokens = expr.match(/attribute_not_exists|attribute_exists|<>|[()=<,]|AND|OR|NOT|[#:]?[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    let i = 0;
    const name = (t: string) => (t.startsWith("#") ? names[t] : t);
    const operand = (t: string) => (t.startsWith(":") ? values[t] : row?.[name(t)]);
    const primary = (): boolean => {
        const t = tokens[i++];
        if (t === "(") { const v = or(); i++; return v; }
        if (t === "NOT") return !primary();
        if (t === "attribute_exists" || t === "attribute_not_exists") {
            i++; const a = name(tokens[i++]); i++;
            const has = row !== undefined && row[a] !== undefined;
            return t === "attribute_exists" ? has : !has;
        }
        const left = operand(t);
        const op = tokens[i++];
        const right = operand(tokens[i++]);
        if (op === "=") return left !== undefined && left === right;
        if (op === "<>") return left !== right;
        if (op === "<") return left !== undefined && left < right;
        throw new Error(`知らない条件: ${expr}`);
    };
    const and = (): boolean => { let v = primary(); while (tokens[i] === "AND") { i++; const r = primary(); v = v && r; } return v; };
    const or = (): boolean => { let v = and(); while (tokens[i] === "OR") { i++; const r = and(); v = v || r; } return v; };
    return or();
}

/** 更新式（SET a = :v, b = if_not_exists(b, :n) / REMOVE a, b）を当てる */
export function applyUpdate(row: Row, expr: string, names: Input = {}, values: Input = {}): Row {
    const out = { ...row };
    const name = (t: string) => (t.startsWith("#") ? names[t] : t);
    for (const m of expr.matchAll(/(SET|REMOVE)\s+(.*?)(?=\s+(?:SET|REMOVE)\s+|$)/g)) {
        for (const part of m[2].split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean)) {
            if (m[1] === "REMOVE") { delete out[name(part)]; continue; }
            const [lhs, rhs] = part.split("=").map((p) => p.trim());
            const ine = rhs.match(/^if_not_exists\(([#\w]+),\s*(:\w+)\)$/);
            out[name(lhs)] = ine ? (out[name(ine[1])] ?? values[ine[2]]) : values[rhs];
        }
    }
    return out;
}

/** users 表の代わり。`send` を `ddb.send` に差し込む。`table` を見て中身を確かめる */
export function fakeUsersTable() {
    const table = new Map<string, Row>();
    const send = async (c: unknown) => {
        const name = (c as { constructor: { name: string } }).constructor.name;
        const input = (c as { input: Input }).input;
        const key = input.Key?.userId ?? input.Item?.userId;
        const row = table.get(key);
        const ok = () => evalCondition(input.ConditionExpression, row, input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        switch (name) {
            case "GetCommand": return { Item: row ? { ...row } : undefined };
            case "PutCommand":
                if (!ok()) throw conditionFailed();
                table.set(key, { ...input.Item });
                return {};
            case "UpdateCommand":
                if (!ok()) throw conditionFailed();
                table.set(key, applyUpdate(row ?? { userId: key }, input.UpdateExpression, input.ExpressionAttributeNames, input.ExpressionAttributeValues));
                return {};
            case "DeleteCommand":
                if (!ok()) throw conditionFailed();
                table.delete(key);
                return {};
            default: throw new Error(`知らない命令 ${name}`);
        }
    };
    return { table, send };
}

// ────────────────────────────── Google（札 journey.photo-ios#715）

export const GOOGLE_CLIENT_ID = "280167931666-24o92d38usbft3ouk3jc4dk8tvgh3t8p.apps.googleusercontent.com";

/** Google の ID トークンの代わり（Apple の代わりと同じ鍵で署名する。鍵の一覧は `fakeGoogle` が返す） */
export function makeGoogleToken(claims: Record<string, unknown> = {}, opts: { key?: KeyObject; header?: Record<string, unknown>; nowSec?: number } = {}): string {
    return makeToken({
        iss: "https://accounts.google.com", aud: GOOGLE_CLIENT_ID, sub: "1098765432101234567890",
        email: "taro@gmail.com", email_verified: true, name: "山田 太郎", ...claims,
    }, opts);
}

/** Google の公開鍵の口の代わり */
export function fakeGoogle(opts: { keys?: () => unknown } = {}) {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
        calls.push({ url, body: init?.body });
        const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
        if (url === "https://www.googleapis.com/oauth2/v3/certs") return reply(200, (opts.keys ?? jwks)());
        return reply(404, {});
    };
    return { fetchImpl, calls };
}
