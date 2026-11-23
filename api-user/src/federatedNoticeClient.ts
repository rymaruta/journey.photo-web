/**
 * サインインの口（Apple・Google）から、「メールで結んだ」知らせを頼む口（札 journey.photo-ios#601・#715）。
 *
 * 🔴 サインインの口は APNs の鍵を持たない（2026-11-23 確かめ役の3回目）。知らせは「Apple でサインイン」のスタックの
 *    知らせだけをする関数（`photo-gallery-apple-signin-<stage>-linkNotice`・`federatedNotice.ts`）に、待たずに
 *    （InvocationType `Event`）頼む。届かなくてもサインインは止めない
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";

export const noticeClientDeps: {
    invoke: (functionName: string, payload: string) => Promise<void>;
    functionName: () => string;
} = {
    invoke: async (FunctionName, payload) => {
        lambda ??= new LambdaClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" });
        await lambda.send(new InvokeCommand({ FunctionName, InvocationType: "Event", Payload: Buffer.from(payload) }));
    },
    functionName: () => (process.env.FEDERATED_NOTICE_FUNCTION ?? "").trim(),
};
let lambda: LambdaClient | null = null;

/** 知らせを頼む（投げない） */
export async function requestLinkNotice(cognitoSub: string, provider: string): Promise<void> {
    const fn = noticeClientDeps.functionName();
    if (!fn) return;
    try {
        await noticeClientDeps.invoke(fn, JSON.stringify({ cognitoSub, provider }));
    } catch (e) {
        console.warn("federated link notice:", (e as { name?: string } | null)?.name ?? "");
    }
}
