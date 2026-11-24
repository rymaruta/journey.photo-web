// lib/utils/appBanner.ts
// iPhone のアプリへの入口（上の帯・ヘッダーの「アプリ」）を出すかの純関数（テスト可能）。
//
// 2026-11-20 owner 判断（札 journey.photo-ios#666）:
// 「iOSのはできるだけ目立つ位置におきたい。よくある方式にしたい」「また見にきた時出した方がいいかな」。
//  - iPhone の Safari は Apple の帯（Smart App Banner・`app/layout.tsx` の `itunes`）のまま。
//    アプリが入っているかを見て「開く」と「入手」を出し分けられるのは Apple の帯だけなので、自前の帯は重ねない
//  - Apple の帯が出ない iPhone のブラウザ（Chrome・Firefox・Edge、LINE・Instagram・Facebook・X の中のブラウザなど）にだけ、
//    頁のいちばん上に自前の帯を出す
//  - × はその訪問の間だけ覚える（sessionStorage）。次に来たらまた出す
//  - ヘッダーの「アプリ」は iPhone なら Safari にも常に出す（帯を閉じた後もここから行ける）

import { iosVersion, isInAppBrowser, isIOSSafari } from "./pwa";

/** × で閉じたことを覚える鍵（sessionStorage・その訪問の間だけ） */
export const APP_TOP_BANNER_CLOSED_KEY = "jp_app_top_banner_closed";

/**
 * アプリが入る iOS の最小の版（journey.photo-ios の `project.yml` の `deploymentTarget`・iOS 17.0）。
 * これより古い iPhone（幅 320 の初代 SE・5s は iOS 15 まで）は App Store へ送っても入れられないので、入口を出さない
 */
export const MIN_APP_IOS_MAJOR = 17;

/** iPhone（と iPod）か。iPad・Mac・Android は含めない（アプリは iPhone 用） */
export function isIPhoneUA(ua: string): boolean {
    return /iPhone|iPod/.test(ua) && !/Android/i.test(ua);
}

/** アプリを入れられる iPhone か（iPhone で、iOS が 17 以上。版が読めなければ入れられると見なす） */
export function canInstallAppUA(ua: string): boolean {
    if (!isIPhoneUA(ua)) return false;
    const v = iosVersion(ua);
    return !v || v[0] >= MIN_APP_IOS_MAJOR;
}

/**
 * 自分のアプリの中の画面か。**今のアプリには Web を開く WebView が無い**（ヘルプは `SFSafariViewController`
 * で、UA は Safari と同じ＝自前の帯はもともと出ない）。将来アプリが UA に `JourneyPhoto/<版>` を足したら、ここで外れる
 */
export function isOwnAppWebView(ua: string): boolean {
    return /\bJourneyPhoto\//.test(ua);
}

/**
 * Apple の帯（Smart App Banner）が出る iPhone の Safari か。
 * `isIOSSafari` に加えて、UA が Safari と同じ形の別のブラウザ（DuckDuckGo の `Ddg/`）を外す
 */
export function isAppleBannerBrowser(ua: string, maxTouchPoints = 0): boolean {
    if (/\bDdg\//.test(ua)) return false;
    return isIOSSafari(ua, maxTouchPoints);
}

/**
 * 自前の上の帯を出すか。
 * 出す: iPhone で、Safari 以外（iOS の Chrome・Firefox・Edge・Opera、アプリの中のブラウザ）。
 * 出さない: Safari（Apple の帯が出る）・iPad・PC・Android・ホーム画面から開いた全画面・自分のアプリの中・この訪問で × を押した後
 */
export function shouldShowAppTopBanner(opts: {
    userAgent: string;
    /** ホーム画面から開いた全画面か */
    standalone: boolean;
    /** この訪問で × を押したか */
    closed: boolean;
    maxTouchPoints?: number;
}): boolean {
    const { userAgent: ua, standalone, closed, maxTouchPoints = 0 } = opts;
    if (closed || standalone) return false;
    if (!canInstallAppUA(ua)) return false;
    if (isOwnAppWebView(ua)) return false;
    if (isInAppBrowser(ua)) return true;
    return !isAppleBannerBrowser(ua, maxTouchPoints);
}

/** この訪問で × を押したか。読めないときは「押していない」（毎回出してよい） */
export function readTopBannerClosed(storage: Pick<Storage, "getItem"> | undefined): boolean {
    try {
        return storage?.getItem(APP_TOP_BANNER_CLOSED_KEY) === "1";
    } catch {
        return false;
    }
}

/** × を押したことを覚える。書けないときは何もしない（その画面の間は部品の状態で閉じている） */
export function writeTopBannerClosed(storage: Pick<Storage, "setItem"> | undefined): void {
    try {
        storage?.setItem(APP_TOP_BANNER_CLOSED_KEY, "1");
    } catch {
        // プライベートモードなど。閉じるだけは行う
    }
}
