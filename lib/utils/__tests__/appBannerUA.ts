// iPhone のアプリの入口のテストで使う UA（`appBanner.test.ts`・`AppTopBanner.test.tsx`）
const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
export const UA = {
    safari: `${IOS} Version/18.1 Mobile/15E148 Safari/604.1`,
    chrome: `${IOS} CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1`,
    firefox: `${IOS} FxiOS/133.0 Mobile/15E148 Safari/605.1.15`,
    edge: `${IOS} Version/18.0 EdgiOS/131.0.2903.68 Mobile/15E148 Safari/605.1.15`,
    line: `${IOS} Mobile/15E148 Safari Line/14.19.0`,
    instagram: `${IOS} Mobile/15E148 Instagram 357.0.0.25.101 (iPhone15,2; iOS 18_1; ja_JP; ja; scale=3.00; 1179x2556; 657575440)`,
    facebook: `${IOS} Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.39.106;FBBV/663458946;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.1;FBSS/3;FBLC/ja_JP;FBOP/5]`,
    x: `${IOS} Mobile/15E148 Twitter for iPhone/10.70`,
    ddg: `${IOS} Version/18.1 Mobile/15E148 Ddg/18.1 Safari/604.1`,
    ownApp: `${IOS} Mobile/15E148 JourneyPhoto/1.1.90`,
    // アプリの入らない iOS 16（幅 320 の初代 SE は iOS 15 まで）
    chromeIOS16: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
    safariIOS15: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
    ipadSafari: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    ipadChrome: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
    macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    pcChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    androidLine: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36 Line/14.19.0",
};
