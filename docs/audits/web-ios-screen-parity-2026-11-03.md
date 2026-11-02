# WEB / iOS 全画面対応監査（2026-11-03）

## 対象・基準
- WEB: `rymaruta/photo-gallery` main（PR #478/#480 マージ後）
- iOS: `rymaruta/journey.photo-ios` main
- この監査ブランチは調査専用。既存画面の実装は変更しない。
- 以下は**ソース上の画面・ルート存在確認**。画面の視覚的な同等性・機能の同等性を実機で確認したものではない。

## 画面対応の一次インベントリ

| 機能領域 | WEBの主なルート | iOSの主なView | 初期判定 |
| --- | --- | --- | --- |
| ホーム/ギャラリー | `app/page.tsx` | `GalleryView.swift` / `HomeTopCardView.swift` | 両方あり・詳細未検証 |
| 写真詳細 | `app/photo/[id]/page.tsx` | `PhotoDetailView.swift` / `PhotoViewerView.swift` | 両方あり・共有カードは重点監査 |
| 検索 | `app/search/page.tsx` | `SearchView.swift` / `GearPhotosView.swift` | 両方あり・検索条件/結果表示の差分要検証 |
| 地図 | `app/map/page.tsx` | `PhotoMapView.swift` | 両方あり・ピン/権限要検証 |
| 撮影スポット | `app/spots/**/page.tsx` | `OfficialSpotView.swift` / `SpotDetailView.swift` | 両方あり・季節/地域別ルート要検証 |
| 撮影地 | `app/location/**/page.tsx` | `SearchView.swift` 等 | WEB専用ルートの対応確認が必要 |
| カメラ/カテゴリ/タグ | `app/camera/**`, `app/category/**`, `app/tag/**` | `GearPhotosView.swift` / `TagPhotosView.swift` | 両方に関連機能・遷移差分要検証 |
| いいね/保存 | `app/favorites`, `app/saves` | `FavoritesView.swift`, `SavedPhotosView.swift` | 両方あり |
| 行きたい場所 | `app/saved-spots` | `SavedSpotsMapView.swift` | 両方あり |
| 旅/旅行記 | `app/trips`, `app/users/trip` | `TripBookView.swift`, `TripPlansView.swift` | 両方あり・機能粒度要検証 |
| ユーザー一覧/公開プロフィール | `app/users/**` | `UserProfileView.swift`, `FollowListView.swift` | 両方あり |
| マイページ | `app/user/profile` | `MyPageView.swift` | 両方あり |
| プロフィール編集 | `app/user/edit` | `ProfileEditView.swift` | 両方あり |
| アルバム | `app/user/albums` | `AlbumsView.swift` | 両方あり |
| 下書き | `app/user/drafts` | `DraftsView.swift` | 両方あり |
| バッジ | `app/user/badges` | `BadgeShelfView.swift`, `MedalViewerView.swift` | 両方あり |
| ハイライト | `app/user/highlights` | `HighlightEditorView.swift` | 両方あり |
| 光予報 | `app/user/light` | `LightForecastView.swift` | 両方あり |
| 設定 | `app/user/settings` | `SettingsView.swift` | 両方あり・設定項目要比較 |
| 写真投稿 | `app/user/upload` | `UploadView.swift`, `PhotoEditView.swift` | 両方あり・画質/EXIF/進捗要検証 |
| ログイン/登録 | `app/login`, `app/signup` | `SignInView.swift` | 登録フローの対応確認が必要 |
| 規約/プライバシー | `app/terms`, `app/privacy` | `LegalLinksView.swift`, `LegalGateView.swift` | 両方あり |
| 管理画面 | `app/admin/**` | 対応View未特定 | WEB専用の可能性（要判断） |
| クイズ | `app/q` | `DailyQuizView.swift` | 両方あり |
| ストーリー | 専用page.tsx未特定 | `StoryComposerView.swift`, `StoryViewerView.swift` | iOS側の機能差候補 |
| 通知 | 専用page.tsx未特定 | `NotificationsView.swift` | iOS側の機能差候補 |
| キャンピングカー/部屋 | 専用page.tsx未特定 | `CamperSceneView.swift`, `CamperRoomView.swift` | iOS側の機能差候補 |
| トランク | 専用page.tsx未特定 | `TrunkView.swift` 等 | iOS側の機能差候補 |
| パス/カード | 専用page.tsx未特定 | `PassBookView.swift`, `PassViewerView.swift` | iOS側の機能差候補 |
| オフライン旅行 | 専用page.tsx未特定 | `OfflineTripView.swift`, `OfflineSavedView.swift` | iOS側の機能差候補 |

## 優先確認
1. **共通画面の表示差**：余白、タイポグラフィ、アイコン/バッジ、画像品質、長い名前、レスポンシブ。
2. **共通機能の動作差**：投稿・保存・検索・地図・プロフィール・設定・公開範囲。
3. **片方のみの機能**：iOSのストーリー/通知/トランク/キャンピングカー/パス、WEBの管理画面/撮影スポット専用ルート。
4. **データ/認証**：API、権限、非公開写真、画像URL、共有リンク。
5. **テスト**：両方の画面遷移、iPhone Safari/実機、長文/画像なし/通信失敗。

## 調査の制約・次段階
- この初回は GitHub の**再帰ツリー（両リポジトリとも truncated=false）**から `page.tsx` と `*View.swift` を列挙した。WEBはルート以外のクライアントコンポーネント、iOSは `*Screen.swift` 等にも画面があり得る。
- したがって「専用page.tsx未特定」はWEBに機能がないという意味ではない。
- 次段階では各ルートのコンポーネントとiOS遷移元、API、表示条件、スクリーンショットを照合し、画面ごとに「一致/差異/仕様上の違い/未検証」を確定する。
- 監査中は本番の画面変更を伴うマージをしない。
