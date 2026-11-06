# 登録までのどこで人が離れているかを数える（2026-10-31・journey.photo-ios#432 の 5 / 2026-11-04 に拡張）

「流入元 → ランディング → 登録画面 → 入力 → 完了」を数える。費用は増やさない（GA4 は無料・
ログは1件あたり約 200 バイト）。Cognito の設定・DB・GSI は変えていない。

## Web（GA4）

イベントの一覧と、送ってよい値の範囲は **`lib/utils/analytics.ts` の `EVENT_SPEC`** が正（型も実行時の検査もここから作る）。
範囲外の値が1つでもあるイベントは送らない。表に無い欄は落ちる。

### 漏斗のイベント

| イベント | いつ | 値 |
|---|---|---|
| `view_signup` | 登録画面を見た（未ログインと分かった回に1度） | `from` |
| `signup_start` | 入力を始めた（初めて入力欄が変わったとき1度） | `from` |
| `signup_error` | 登録の入力・確認コードで断られた | `step`: `form` / `confirm`、`reason`（下） |
| `sign_up` | 登録の確認コードが通った（もう確認済みだった回は送らない）。**推奨イベント・成果** | `method`: `email`、`from` |
| `login` | ログインに成功した（推奨イベント） | `method`: `email` |
| `wish_tap` | 「行きたい」を押した（撮影スポット・撮影地・写真の「次の旅へ」・地図・クイズ） | `signed_in`: 0（未ログイン＝ログインへ）/ 1（保存した。外したときは送らない）、`kind`: `spot` / `location` |

- `from`: `wish`（「行きたい」から来た）/ `other`。行きたいのリンクだけが `/login?…&via=wish` を付け、
  ログイン画面の「新規登録」が `/signup?…&via=wish` に運ぶ（`signupFromVia`）
- `reason`（決まった語だけ。**エラーの文言や入力値は送らない**。Cognito の例外名から `signupErrorReason` が分ける）:
  `password_mismatch` / `password_short`（画面側の検査）、`password_rule`、`invalid_input`、`already_registered`、
  `code_mismatch`、`code_expired`、`alias_exists`（そのメールを別のアカウントが使っている）、`rate_limit`、`network`、`other`

### 着地の種類 `landing_type`

そのセッションで**最初に着地した頁の種類**。**全イベントに自動で付く**（`track` が足す）。
最初の頁を開いた時に `sessionStorage` へ語を1つだけ書き（Cookie ではない・タブを閉じれば消える）、
以後は読むだけ。ストレージが使えない環境では `other`。判定は `lib/utils/landingType.ts` の `landingTypeOf`（純粋関数）。

| 値 | 頁 |
|---|---|
| `home` | `/` |
| `learn` | `/learn` 以下（写真とカメラの教科書） |
| `composition` | `/composition` 以下 |
| `spot` | `/spots` 以下（一覧・県・テーマ・季節・各スポット） |
| `photo` | `/photo/<id>`、`/?photo=<id>` |
| `location` | `/location` 以下 |
| `tag` | `/tag` 以下 |
| `category` | `/category` 以下 |
| `other` | 上のどれでもない（登録・ログイン・地図・ユーザーの頁など）／ストレージが使えない |

### そのほかのイベント

| イベント | いつ | 値 |
|---|---|---|
| `app_store_click` | App Store へのリンクを押した | `placement`: `footer`（フッターの文字リンク）/ `banner`（iOS の端末に出すフッターの案内カード）/ `article`（記事内のリンク用。いまは記事内に App Store リンクが無く未使用） |
| `upload_start` | 投稿（公開・下書き保存）を押した | `photo_count`（枚数） |
| `upload_complete` | **公開に成功した**（下書き保存は数えない）。成果の候補 | `photo_count` |
| `upload_error` | 投稿に失敗した写真があった（1回の操作で1度） | `reason`: `unsupported_file` / `network` / `server` / `other` |
| `select_content` | 記事から、スポット・作例の写真・次の記事のリンクを押した | `content_type`: `spot` / `photo` / `article`、`item_id`（リンク先の最後の区切り＝記事・スポットの slug・写真の id。英数字・`-`・`_`・80字以内の形だけ。**2026-11-06 owner「どちらでも」→ 推奨で送る**） |
| `search` | サイト内検索で、打ち終えて約1.5秒たった（同じ語は続けて数えない・2文字以上） | `search_term_length`、`result_count`（写真の件数）。**語そのものは送らない**（2026-11-06 owner「どちらでも」→ 推奨で送らない。入力した文字を外部へ出さない）。ユーザー検索は対象外 |
| `share` | 共有できた（共有シート・リンクのコピー・X・LINE。閉じた回は数えない） | `method`: `native` / `copy` / `x` / `line`、`content_type`: `photo` / `spot` / `quiz` / `trip` |
| `like_photo` | 写真にいいねを付けた（サーバーに届いた回。外した回・未ログインは数えない） | なし |
| `follow_user` | フォローした（外した回は数えない） | なし |

Smart App Banner（`app/layout.tsx` の `itunes` meta）は Safari が描く帯で、押下をページから取れないので対象外。

### 送らないもの

メール・氏名・ユーザー名・uid・撮影スポットの slug・写真の id・検索語・エラーの文言・入力した値。
自由な文字列を渡せる欄は作らない（型で閉じる）。同意バナーは入れない（owner の判断）。
`app/privacy/page.tsx` の記述（GA4 を使い Cookie を使う）と矛盾しない。

### 読み込み前・広告ブロック

GA4 の読み込み（`lazyOnload`）より前に起きたものは `window.__jpq` に積み（20 件まで）、初期化の行で送る。
`gtag` が無い（広告ブロック・開発・staging）ときは何もしない・例外も出さない。

## 漏斗の定義（GA4 の「探索」→「目標到達プロセス」）

| 段 | イベント | 備考 |
|---|---|---|
| 0 流入 | `session_start` / `page_view`（ディメンション: 流入元・メディア） | 検索流入は Search Console 連携で見る |
| 1 ランディング | `page_view`（GA4 標準の「ランディング ページ」ディメンション） | 自前の `landing_type` は `page_view` には付かず、2 以降のイベントに付く。"どの種類の頁から来た人が登録したか"は `landing_type` で絞る |
| 2 登録画面 | `view_signup` | `from` で「行きたい」経由かを分ける |
| 3 入力 | `signup_start` | 画面を見て離れた人は 2 と 3 の差 |
| 4 完了 | `sign_up` | キーイベント。2 → 4 の間の失敗は `signup_error` の `step` と `reason` で見る |

「行きたい」を押した人の導線は `wish_tap`（`signed_in` = 0）→ `view_signup`（`from` = wish）→ `sign_up`。
登録後の行動は `login`・`upload_start` → `upload_complete`（キーイベント）。
カスタム ディメンション（イベント スコープ）に登録すると絞り込める: `from`・`landing_type`・`signed_in`・`kind`・
`placement`・`step`・`reason`・`content_type`・`photo_count`（`photo_count` は指標としても使える）。

## サーバー（正しい登録の数）

Web は `confirmRegistration` に `ClientMetadata {platform: "web", from}` を渡す。
Cognito の PostConfirmation のトリガー（`api/src/cognitoTrigger.ts`）が、
`PostConfirmation_ConfirmSignUp` の回だけ、次の1行をログに出す:

```
{"metric":"signup","platform":"web","from":"wish"}
```

値は決まったものだけ（`platform`: web / ios / unknown、`from`: wish / other / unknown）。
iOS はまだ ClientMetadata を渡していないので `unknown` になる。GA4 の `sign_up` は
広告の遮断などで漏れるので、登録の数はこちらを正とする。

### 数え方（CloudWatch Logs Insights）

ロググループ: `/aws/lambda/photo-gallery-api-prod-postConfirmation`（staging は `-staging-`）

```
fields @timestamp, @message
| filter @message like /"metric":"signup"/
| parse @message '"platform":"*","from":"*"' as platform, source
| stats count(*) as signups by bin(1d) as day, platform, source
| sort day desc
```

Lambda のログは文字の形（頭に時刻・要求 ID・INFO が付く）なので、JSON の欄は自動では
取り出されない。`parse` で取り出している。
