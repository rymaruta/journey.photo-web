# journey.photo — Web

旅の写真を置く個人ギャラリー <https://journey-photo.com> のソースです。
**写真が主役**で、優先するのは **SEO・表示速度・安定性** です。

- 画面は Next.js の**静的書き出し**（`output: export`）。AWS 上で配信します
- 会員機能（登録・投稿・フォロー・コメントなど）は、別立ての API（AWS Lambda）が受け持ちます
- 表示言語は日本語のみです（切り替えの画面はありません）
- iOS 版アプリは別のリポジトリです: [`rymaruta/journey.photo-ios`](https://github.com/rymaruta/journey.photo-ios)。
  同じサーバー（API）を使います

> このリポジトリは**公開**です。AWS のリソース名・ID・URL・鍵・個人情報は、README にも docs にも書かない方針です。
> 必要な値の取り出し方は [`CLAUDE.md`](./CLAUDE.md) の「環境ごとの値の取り出し方」にあります。

---

## 何ができるか

- 写真の一覧・拡大表示・個別ページ、タグ・撮影地・カテゴリ・機材ごとのまとめページ、地図、サイト内検索
- 撮影スポットの案内ページ
- ホーム画面に追加して使える PWA（一度見たページと写真はオフラインでも出ます）
- 会員向け: 投稿・編集・下書き、ストーリー、共同アルバム、プロフィール、フォロー・コメント・いいね・通知

## 動かす

Node.js 22 を使います。

```bash
npm ci
npm run dev        # http://localhost:3000
```

写真データは `app/data/photos.json` を読みます。手元では、リポジトリに入っている**ある時点の断面**を使います。
本番と同じ形で建てるには、データベース（DynamoDB）に接続できる AWS の認証情報が要ります。

```bash
npm run build      # 写真データを同期してから静的書き出し
npm test           # 単体テスト（vitest）
npm run lint
npm run type-check
```

> 手元で `next build` を直接叩くときは、本番と同じ環境変数（`NEXT_PUBLIC_*`）を渡してください。
> 渡さないと、画像の URL を揃える処理が効かないビルドができます。
> 値は [`CLAUDE.md`](./CLAUDE.md) の手順で取り出します。

## 検査（反映の前に必ず通す）

```bash
npm run verify
```

CI（`.github/workflows/`）が通す関門を手元でまとめて回します（型検査・lint・単体テスト・ビルド・実ブラウザのスモーク）。
`vitest` は型を見ないので、テストが全部緑でもビルドが落ちることがあります。
逆にビルドが通っても、実ブラウザでだけ落ちることもあります。片方だけでは「落ちない」と言えません。

## ブランチと環境

| 環境 | ブランチ | 備考 |
|---|---|---|
| 本番 | `main` | `main` への push で自動反映 |
| ステージング | `develop` | 検索エンジンに載らない設定。フロントの反映は手動実行 |

```
feature/xxx  →(PR)→  develop  →(確認)→  main  →(自動)→  本番
```

- 本番へ直接 push しません。
- 環境ごとの設定は、ブランチ名からワークフローが決めます。値が欠けたときは、別の環境の値で動かさず**失敗**させます。
- API（`api/**`・`api-user/**`）は、触った push で自動反映されます。
- 反映は GitHub Actions に任せます。手元から流すと、パラメータの渡し忘れで別の環境を向くことがあります。
- GitHub Actions の実行時間には枠があります。流す前に [`CLAUDE.md`](./CLAUDE.md) の注意を読んでください。

## ディレクトリの要点

```
app/            Next.js の App Router（画面）
  components/   画面部品
  photo/        写真ページ
  tag|location|category|camera/   まとめページ
  user/ users/  投稿・プロフィールまわり
  admin/        管理画面
  i18n/         表示ラベル
  data/         写真データ（ビルド時に生成）
lib/            画面から独立した関数・フック
api-user/       利用者向け API（AWS Lambda・Serverless Framework）
api/            管理向け API
content/        撮影スポットの台帳など
scripts/        ビルド・反映・保守・診断の道具
public/         サービスワーカー・マニフェストなど
docs/           設計と運用のドキュメント
.github/workflows/   反映・保守・見張り
```

`app/api/` は開発専用で、ビルドのときに自動で退避されます。

## ドキュメント

| | |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | 作業の決まり・環境ごとの値の取り出し方・反映の手順・注意事項 |
| [`DOCS.md`](./DOCS.md) | ドキュメントの索引 |
| [`docs/architecture.md`](./docs/architecture.md) | 全体の作り |
| [`docs/PRODUCTION_SETUP.md`](./docs/PRODUCTION_SETUP.md) | 環境の構築手順 |
| [`docs/api-user.md`](./docs/api-user.md) | 利用者向け API |
| [`docs/strategy-2026-09.md`](./docs/strategy-2026-09.md) | 方向性の検討 |

## ライセンス

プライベートプロジェクトです。無断での転載・再配布はできません。
