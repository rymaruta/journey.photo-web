# 管理者API ドキュメント

> 公開リポジトリのため、実際のバケット名・各種 ID・URL は書いていません。
> `<環境>` は `prod` か `staging`、`<…-id>` などの山括弧は置き換え記号です。
> 実際の値の取り出し方は [`CLAUDE.md`](../CLAUDE.md) の「環境ごとの値の取り出し方」。

## エンドポイント

**Base URL:** `https://<admin-api-id>.execute-api.ap-northeast-1.amazonaws.com`  
**Lambda:** `photo-gallery-api-prod-api`  
**認証:** Cognito JWT（`admin` グループ必須）

## エンドポイント一覧

### 写真取得（公開）

```
GET /api/photos
```
全写真一覧を返す。認証不要。

```
GET /api/photos/{id}
```
指定IDの写真を返す。認証不要。

### 写真更新（管理者のみ）

```
PUT /api/photos/{id}
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "title": { "ja": "タイトル", "en": "Title" },
  "description": { "ja": ["説明1", "説明2"], "en": ["Desc1"] },
  "location": "場所",
  "category": "カテゴリ",
  "tags": ["tag1", "tag2"],
  "published": true
}
```

#### 「おすすめ」（featured）の置き方（2026-11-09）

ホームの「おすすめ」に運営が選んだ写真を置く仕組みは**もうある**（作り足す物は無い）。管理者でログインして `/admin` の一覧から写真の編集（`/admin/edit?id=<写真の ID>`）を開き、「おすすめに出す」のスイッチを入れて保存する。保存は上の `PUT /api/photos/{id}` に `"featured": true` を載せるのと同じで、`featured` を書けるのは管理 API だけ（利用者は書けない・`docs/api-reference.md`）。印が付いた**公開の写真だけ**が、ホームの「おすすめ」タブの先頭にカテゴリごとの段（`FeaturedSections`）で並び、その下に残りの写真（いいねの多い順）が続く（非公開は印があっても出ない）。印が1枚も無い間は、ホームの既定は「新着」のまま（本番の実データは `featured` 0枚）。印を付ければ、おすすめが既定のタブになる。**どの写真を選ぶかは owner が決める**（投稿者が公開にした写真だけが対象）。

### 写真削除（管理者のみ）

```
DELETE /api/photos/{id}
Authorization: Bearer {JWT}
```

### アップロード（管理者のみ）

**Step 1: Presigned URL取得**
```
POST /api/upload/presigned-url
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "fileName": "photo.jpg",
  "fileType": "image/jpeg",
  "fileSize": 1048576
}
```

**Step 2: S3へ直接PUT**
```
PUT {presignedUrl}
Content-Type: image/jpeg
[バイナリデータ]
```

**Step 3: メタデータ保存**
```
POST /api/upload/save
Authorization: Bearer {JWT}
Content-Type: application/json

{
  "key": "uploads/{uuid}.jpg",
  "publicUrl": "https://<distribution-domain>.cloudfront.net/uploads/{uuid}.jpg",
  "photoId": "{uuid}",
  "title": { "ja": "タイトル", "en": "Title" },
  "description": { "ja": ["説明"] },
  "location": "場所",
  "category": "カテゴリ",
  "tags": ["tag1"]
}
```

## データ保存先

- メタデータ: `S3 <環境>-journey-photo.com/app/data/photos.json`
- 画像: `S3 <環境>-journey-photo-upload/uploads/{uuid}.jpg`

## デプロイ

```bash
cd api/
npm install
serverless deploy --stage prod \
  --param="cognitoUserPoolId=ap-northeast-1_<pool-id>" \
  --param="cognitoClientId=<client-id>" \
  --param="photosBucket=<環境>-journey-photo.com" \
  --param="uploadBucket=<環境>-journey-photo-upload" \
  --param="cloudfrontUrl=https://<distribution-domain>.cloudfront.net"
```
