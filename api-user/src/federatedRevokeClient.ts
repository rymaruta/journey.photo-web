/**
 * 退会（user API の `deleteAccount`）から、外のアカウントの更新トークンの取り消しを頼む口（札 journey.photo-ios#601）。
 *
 * 🔴 **鍵は user API に置かない。** Apple の鍵（APNs の鍵）を読めるのは「Apple でサインイン」のスタックだけにし、
 *    取り消しはそのスタックの関数（`photo-gallery-apple-signin-<stage>-appleRevoke`・`appleSignin.ts` の
 *    `revokeTokenHandler`）に頼む。user API の役に足すのはその関数を呼ぶ権限だけ（`serverless.yml` の
 *    `AppleRevokeInvokePolicy`）。鍵を環境変数に置くか SSM に置くかは `deploy-api.yml` の1か所で決まり、
 *    退会の側は変わらない（2026-11-23 確かめ役の指摘）
 *
 * スタックを配っていない環境（関数が無い）は `unavailable`（退会は止めない）
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { Revoker } from "./federatedAccount";

export const revokeClientDeps: {
    invoke: (functionName: string, payload: string) => Promise<{ payload?: string; functionError?: string }>;
    functionName: () => string;
} = {
    invoke: async (FunctionName, payload) => {
        lambda ??= new LambdaClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
        const res = await lambda.send(new InvokeCommand({ FunctionName, Payload: Buffer.from(payload) }));
        return { payload: res.Payload ? Buffer.from(res.Payload).toString("utf8") : undefined, functionError: res.FunctionError };
    },
    functionName: () => (process.env.APPLE_REVOKE_FUNCTION ?? "").trim(),
};
let lambda: LambdaClient | null = null;

const RESULTS = new Set(["revoked", "failed", "rejected", "unavailable"]);

/** Apple の取り消し（`deleteAccount` が `revokeLinkedTokens` に渡す） */
export const appleRevokeViaStack: Revoker = async (refreshToken) => {
    const fn = revokeClientDeps.functionName();
    if (!fn) return "unavailable";
    try {
        const res = await revokeClientDeps.invoke(fn, JSON.stringify({ provider: "apple", refreshToken }));
        if (res.functionError) return "failed";
        const result = (JSON.parse(res.payload ?? "{}") as { result?: unknown }).result;
        return typeof result === "string" && RESULTS.has(result) ? result as Awaited<ReturnType<Revoker>> : "failed";
    } catch (e) {
        // 関数が無い（スタックを配っていない環境）・呼ぶ権限が無い は止めない。それ以外（混雑・時間切れ）は止めてやり直す
        const name = (e as { name?: string } | null)?.name ?? "";
        if (name === "ResourceNotFoundException" || name === "AccessDeniedException") return "unavailable";
        return "failed";
    }
};
