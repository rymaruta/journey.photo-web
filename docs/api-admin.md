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
