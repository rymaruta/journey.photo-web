import type { Metadata } from "next";
import { siteConfig, NOINDEX_FOLLOW_ROBOTS } from "@/lib/utils/seo";
import { ROUTES } from "@/lib/routes";

// 「サインインの方法」の案内（札 journey.photo-ios#601・2026-11-23 owner）。
// Apple・Google の連携をメールで知らせるとき（`api-user/src/federatedNotice.ts` の `SIGNIN_METHODS_URL`）のリンクの行き先。
// 連携の解除はアプリの設定でする（Web には解除の画面を作らない。2026-11-23 判断: 最小の頁）。
// アプリでこの道を開く（universal link）のは、iOS が associated domains を持ってから（AASA にはまだ書かない）。
// 検索には出さない
export const metadata: Metadata = {
    title: "サインインの方法",
    description: "Apple や Google との連携は、アプリの設定から解除できます。",
    alternates: { canonical: `${siteConfig.url}${ROUTES.SIGNIN_METHODS}` },
    robots: NOINDEX_FOLLOW_ROBOTS,
};

export default function SigninMethodsPage() {
    return (
        <main className="mx-auto max-w-xl px-4 py-10">
            <h1 className="text-2xl font-bold tracking-tight">サインインの方法</h1>
            <div className="mt-6 text-sm text-white/75 leading-relaxed space-y-3">
                <p>心当たりが無ければ、アプリから連携を解除できます。</p>
                <ol className="list-decimal pl-5 space-y-1.5">
                    <li>{siteConfig.name} のアプリを開く</li>
                    <li>設定の「サインインの方法」を開く</li>
                    <li>Apple か Google の「解除」を押す</li>
                </ol>
                <p>ほかに入る方法が無いときは、ログイン画面の「パスワードを忘れた」から、パスワードを設定できます。</p>
            </div>
        </main>
    );
}
