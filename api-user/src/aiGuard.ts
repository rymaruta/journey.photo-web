/**
 * AI に答えさせないもの（札 journey.photo-ios#652・owner 2026-11-20「このアプリの作りは？みたいなセキュリティ的なことは絶対にだめだよ！！！」）。
 * CLAUDE.md「AI はアプリの作りやセキュリティのことを答えない（絶対）」。
 *
 * 言葉の指示だけに頼らない。ここは2段の見張り:
 *
 * 1. **呼ぶ前の断り**（`refuseBeforeCall`）: 決まった言葉で分かる質問は AI を呼ばずに断る（費用0円・回数も使わない）
 *    - アプリ・サーバーの作りと仕組み、使っている AI・サービス・API・鍵・設定、AI への指示文、管理者の機能、
 *      ほかの利用者の非公開の情報、セキュリティの弱点、指示を書き換えようとする文
 *    - ふつうの使い方の質問（「ストーリーの作り方」「鍵垢にするには」「写真を非公開にするには」「DM の送り方」
 *      「金沢のモデルコース」）は通す（`aiGuard.test.ts` の通す一覧）
 * 2. **答えの前の見張り**（`leaksInAnswer`）: 答えに鍵の形・AWS の ARN・内部の名前・公開の頁以外の URL・
 *    メールアドレスが混じったら、答えを出さずに断りの1行に替える
 *
 * そもそも AI に渡すのは、公開の情報（観光スポットの台帳・使い方の頁）とその人の物（打った文・直前の2往復）だけ。
 * 作りの資料・設定・コードは文脈に入れない（`aiAsk.ts`）。
 */

/** 断りの1行（owner 承認の文のまま） */
export const REFUSAL = "この質問にはお答えできません。旅や写真、アプリの使い方のことなら聞いてください。";

/** 字の揺れをそろえる（全角・半角、大文字・小文字、見えない字） */
export function normalize(s: string): string {
    return s.normalize("NFKC").toLowerCase().replace(/[​-‏⁠﻿]/g, "");
}

/** 空白と区切りの記号を除いた形（「A P I キー」「ア・プ・リの作り」でも当たるように）。長音の「ー」は語の一部なので残す */
const compact = (s: string) => normalize(s).replace(/[\s\u3000・･.,、。_\-~*'"`「」『』()（）[\]【】]/g, "");

// 空白を除いた形で見る（日本語）。「作り方」「鍵垢」「モデルコース」のような使い方・旅の言葉に当たらないようにする。
// 英字の語は前後が英字でないときだけ当てる（`(?<![a-z])`）。英語の文も空白を除いて見るので「laws」の aws に当てない
const L = "(?<![a-z])";
const R = "(?![a-z])";
const JA_BEFORE: RegExp[] = [
    // アプリ・サーバーの作りと仕組み（「城の内部の構造」「金閣寺はどうやって作られた」は通す）
    new RegExp(`(アプリ|あぷり|${L}app${R}|サーバ|さーば|システム|サイト|サービス|バックエンド|フロントエンド)の?(作り(?!方)|つくり(?!かた)|構成|仕組み|しくみ|設計|構造|アーキテクチャ|中身|裏側|実装|技術)`),
    new RegExp(`(アプリ|あぷり|${L}app${R}|サイト|サーバ|システム|このai|あなた)(は|って)?(どう|どうやって|どのように|何で|なにで)(作|つく)(られ|って|る)`),
    /(技術スタック|開発言語|プログラミング言語|フレームワーク|ソースコード|ソース(を|見せ|教え)|コードを(見せ|教え|出)|リポジトリ|github|データベース|テーブル(名|構成|の名前)|環境変数|設定ファイル|設定値|インフラ|サーバ(ー)?(は|の場所|どこ|名|のアドレス|のip|の設定|に入|を教え)|エンドポイント|ipアドレス)/,
    // 使っている AI・サービス（「どのサービスエリア」「何のモデルコース」は通す）
    new RegExp(`(どの|どこの|何の|なんの|何という|なんという)(${L}ai${R}|エーアイ|モデル(?!コース)|言語モデル|${L}llm${R}|クラウド|${L}api${R})`),
    new RegExp(`(${L}ai${R}|エーアイ|${L}llm${R})(は|って)(何|なに)(を使|の|という|製|社)`),
    new RegExp(`(${L}ai${R}|エーアイ|モデル(?!コース)|${L}llm${R})(は|って)(どこ|どれ)`),
    new RegExp(`(使って|つかって)(いる|る|います)(${L}ai${R}|エーアイ|モデル(?!コース)|サービス|クラウド|サーバ|データベース|${L}api${R})`),
    /(言語モデル|モデル名|モデルの名前|大規模言語|生成ai(は|の名前))/,
    new RegExp(`${L}(chatgpt|openai|gpt|claude|anthropic|gemini|bedrock|amazonnova|novalite|llama|foundationmodels?)`),
    new RegExp(`${L}(aws|amazonwebservices|lambda|dynamodb|cognito|cloudfront|s3バケット|apigateway)${R}`),
    // API・鍵・設定（「鍵垢」「シークレットスポット」「パスワードを変えるには」は通す）
    new RegExp(`(${L}api${R}|アクセス|秘密|認証|暗号化?|署名|管理者|管理)の?(鍵|キー|トークン)`),
    new RegExp(`(${L}apiキー|${L}apikey|トークン|認証情報|クレデンシャル|秘密鍵|シークレットキー|${L}secretkey|${L}accesskey)`),
    // 指示文・指示の書き換え
    /(指示文|システムプロンプト|プロンプト|システムの指示|システムメッセージ|初期設定の指示|命令文|設定された指示|最初の指示)/,
    /(前|上|これまで|今まで|最初)の(指示|命令|ルール|決まり)(を|は)?(忘れ|無視|わすれ|捨て|取り消|なかったこと|リセット)/,
    /(指示|命令|ルール|決まり)(を|は)?(忘れ|無視|わすれ|破)/,
    // 「公開範囲の制限を外すには」は通す（AI・あなたの制限のときだけ）
    new RegExp(`(${L}ai${R}|エーアイ|あなた|きみ|お前)の?(制限|ルール|決まり|縛り|フィルター)を?(解除|外|無視|破|なく)`),
    /(開発者モード|デベロッパーモード|脱獄|ジェイルブレイク|制限なしモード|なんでも答えるモード|あなたは今から|役になりきって|ロールプレイ)/,
    // 管理者の機能
    /(管理者|管理画面|運営の画面|運営画面|管理用|管理ページ|管理機能|特権|運営者の権限|adminページ|admin画面)/,
    // ほかの利用者の非公開の情報（「写真を非公開にするには」「DM の送り方」は通す）
    /(さん|くん|ちゃん|氏|あの人|その人|この人)(の|との|が)?(非公開|鍵垢の写真|dm|ダイレクトメッセージ|メアド|メールアドレス|現在地|居場所|今いる場所|行きたい場所|パスワード|本名|個人情報|ipアドレス)/,
    /(他人|他の人|ほかの人|他のユーザー|ほかのユーザー|他の利用者|ほかの利用者|別の人|別のユーザー|特定の人|特定のユーザー)(の|との|が)?(非公開|鍵垢|dm|ダイレクトメッセージ|メッセージ|やりとり|やり取り|会話|メール|メアド|住所|電話|現在地|居場所|位置|今いる|行きたい場所|旅行プラン|パスワード|本名|個人情報|ipアドレス|ログイン|アカウント)/,
    /(さん|くん|ちゃん|氏|あの人|その人)(は|が)?(今|いま)(どこ|何して|なにして)/,
    /(非公開の(写真|投稿|アカウント)を(見|のぞ|覗)|鍵垢(の写真)?を(見|のぞ|覗)|ブロックされた(人|相手)(の|を)(見|のぞ))/,
    /(個人情報|メールアドレス|メアド)(を|の)?(教え|見せ|調べ|一覧|抜)/,
    // セキュリティの弱点（「渋滞の抜け道」は通す）
    /(弱点|脆弱性|ぜい弱|セキュリティホール|セキュリティの穴|バグを(突|使)|ハッキング|クラッキング|不正アクセス|乗っ取|侵入する方法|攻撃(方法|する方法|の仕方|手順)|すり抜け|裏技で(無料|pro|上限)|上限を(回避|超え|突破|解除|外)|回数制限を(回避|超え|突破|解除|外|なく)|制限を(回避|突破)|無料でpro|課金を(回避|すり抜)|sqlインジェクション|インジェクション|ブルートフォース|総当たり)/,
    new RegExp(`${L}(xss|csrf|ddos)${R}`),
];

// そのまま（空白を残した小文字）で見る（英語。単語の境目を使う。「temple architecture」「secret spots」「crack of dawn」は通す）
const EN_BEFORE: RegExp[] = [
    /\bhow (is|was|are|were|did you|do you) .{0,20}\b(app|site|service|server|backend|system|website|you)\b.{0,20}\b(built|made|implemented|designed|architected|coded|hosted|structured|work internally)\b/,
    /\b(app|site|server|system|software|backend|your|its) (architecture|infrastructure|tech stack|internals)\b/,
    /\b(architecture|infrastructure|internals) of (this|the|your) (app|site|service|system|server|backend)\b/,
    /\b(tech stack|technology stack|backend|back-end|source code|codebase|repository|github repo|database schema|env(ironment)? var(iable)?s?|config(uration)? (file|values?)|api endpoints?|internal api)\b/,
    /\b(what|which) (ai|model(?! course)|llm|language model|cloud|database|server|framework|provider|vendor)\b/,
    /\b(are you|is this|is it) (gpt|chatgpt|claude|gemini|llama|nova|an? (ai|llm|language model))\b/,
    /\b(chatgpt|openai|gpt-?\d|claude|anthropic|gemini|bedrock|amazon nova|nova lite|llama|foundation models?)\b/,
    /\b(aws|lambda|dynamodb|cognito|cloudfront|s3 bucket|api gateway)\b/,
    /\b(api[ -]?keys?|secret[ -]?keys?|access[ -]?keys?|private[ -]?keys?|access[ -]?tokens?|auth[ -]?tokens?|bearer tokens?|credentials?)\b/,
    /\b(system prompt|system message|your (prompt|instructions|rules)|initial instructions|hidden instructions|developer (message|mode)|prompt injection|jailbreak|dan mode)\b/,
    /\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|prior|above|earlier|all|your|the)\b.{0,20}\b(instructions?|rules?|prompts?|directions?|guidelines?)\b/,
    /\b(reveal|print|show|repeat|output|tell me)\b.{0,30}\b(system prompt|your prompt|the prompt|your instructions|hidden rules|rules you were given)\b/,
    /\b(admin|administrator|admin panel|moderator tools?|superuser|root access)\b/,
    /\b(someone|somebody|another user|other users?|other people|a user)'?s? ?(private|hidden|dms?|direct messages?|messages|emails?|e-?mail address(es)?|address(es)?|phone( numbers?)?|location|whereabouts|saved places|passwords?|real names?)\b/,
    /\b\w+'s (private (photos?|posts?|account)|dms?|direct messages|e-?mail( address)?|password|saved places|current location|whereabouts)\b/,
    /\bwhere is (@\w+|\w+ (san|kun|chan)\b)/,
    /\b(vulnerabilit(y|ies)|exploits?|security (hole|flaw|weakness|bug)s?|weak ?(spot|point)s? (of|in) (this|the|your) (app|site|system|server)|hack(ing)? (into|the|this|an?)|hack this|crack (the|this|into|a|passwords?)|brute[ -]?force|sql injection|xss|csrf|ddos|bypass (the )?(limit|paywall|pro|rate limit|quota))\b/,
];

/** AI を呼ぶ前に断る質問か（true なら断りの1行で返す） */
export function refuseBeforeCall(text: string): boolean {
    const c = compact(text);
    if (JA_BEFORE.some((r) => r.test(c))) return true;
    const l = normalize(text).replace(/\s+/g, " ");
    return EN_BEFORE.some((r) => r.test(l));
}

// ---------- 答えの前の見張り ----------

/** 公開の頁として出してよい URL の場所（journey-photo.com とその下だけ） */
const PUBLIC_HOSTS = /^(?:[a-z0-9-]+\.)*journey-photo\.com$/;

const KEY_SHAPES: RegExp[] = [
    /\b(AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|AGPA)[A-Z0-9]{12,}\b/,
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/,
    /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /\bAIza[0-9A-Za-z_-]{30,}/,
    // 区切りの無い長い英数字（鍵・トークンの形。数字と英字が混じったもの。URL の「-」「/」の多い道は当てない）
    /(?=[A-Za-z0-9+=_]*\d)(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{32,}/,
    /\b[0-9a-f]{32,}\b/i,
];

const INTERNAL_NAMES: RegExp[] = [
    /\barn:[a-z0-9-]*:/i,
    /\baiuse#|\brebuild#|#all#/i,
    /\b(photo-gallery|journey\.photo-web|journey\.photo-ios|api-user|trip-ai|tripai|aiquota|aiguard|serverless|esbuild)\b/i,
    /\b(photos_table|users_table|photos-test|prod-photos|dev-photos|userid-createdat|storyfeed|publicfeed)\b/i,
    /\b(lambda|dynamodb|cognito|cloudfront|execute-api|amazonaws|bedrock|api gateway|s3:\/\/)\b/i,
    /\b(amazon nova|nova[ -]lite|nova-v1|anthropic|claude|chatgpt|openai|gpt-?\d|gemini|llama)\b/i,
    /(システムプロンプト|システムの指示|指示文|system prompt|"refuse"|"general"|<資料>|<会話>|<質問>|refuse を|general を)/i,
    /(案内係です|答えは json だけ)/i,
];

const URL_LIKE = /\b(?:https?:\/\/|www\.)[^\s<>"'）)」]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|jp|io|dev|app|co|cloud|aws|ai|info|biz|me|xyz)\b(?:\/[^\s<>"'）)」]*)?/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function urlHost(u: string): string {
    const s = u.replace(/^https?:\/\//i, "").replace(/^www\./i, "www.");
    return s.split(/[/?#:]/)[0].toLowerCase();
}

/** 答えに出してはいけないものが混じっているか（true なら断りに替える） */
export function leaksInAnswer(answer: string): boolean {
    const t = answer.normalize("NFKC");
    if (EMAIL.test(t)) return true;
    if (KEY_SHAPES.some((r) => r.test(t))) return true;
    if (INTERNAL_NAMES.some((r) => r.test(t))) return true;
    for (const m of t.matchAll(URL_LIKE)) {
        if (!PUBLIC_HOSTS.test(urlHost(m[0]))) return true;
    }
    return false;
}
