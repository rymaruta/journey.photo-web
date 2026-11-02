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

## 第2段階：画面内部のソース照合（2026-11-03）

今回実際に開いたファイル（WEB 7件、iOS 7件）:
- WEB: `app/page.tsx`, `app/photo/[id]/PhotoPageClient.tsx`, `app/search/SpotSearchResults.tsx`, `app/user/settings/page.tsx`, `app/user/profile/page.tsx`, `app/user/upload/page.tsx`, `app/trips/page.tsx`
- iOS: `GalleryView.swift`, `PhotoDetailView.swift`, `SearchView.swift`, `SettingsView.swift`, `MyPageView.swift`, `UploadView.swift`, `TripBookView.swift`（いずれも `Sources/JourneyPhoto/Features/` 以下）

| 項目 | WEBで確認した具体的内容 | iOSで確認した具体的内容 | 判定・次の確認 |
| --- | --- | --- | --- |
| 写真詳細の操作 | `PhotoPageClient.tsx` に前後写真移動、撮影地・スポットリンク、作者リンク、いいね・コメント・保存・共有のボタン | `PhotoDetailView.swift` に作者/撮影地の遷移、保存・共有・コメント・ブロック、近くの写真 | 共通操作は存在。ボタン順、モーダル、共有画像の生成経路は未一致 |
| 写真詳細のEXIF | WEBは保存済みEXIFを使い、不足時に `exifr` を遅延ロードして補完する処理あり | iOSは写真詳細のメタ情報表示と共有カード機能あり | WEBの再抽出経路とiOSの表示項目・安全性を要比較 |
| 撮影スポット検索 | WEB `SpotSearchResults.tsx` に検索結果リンク、展開ボタン。PR #480で代表画像表示を変更 | iOS `SearchView.swift` に季節・時間帯・色・機材・人気撮影地などの絞り込み/発見セクション | **検索UIの構成差が明確**。WEBの検索全体は `app/search/page.tsx` だけでは把握不可、子コンポーネント追跡が必要 |
| 設定 | WEB `app/user/settings/page.tsx` にプロフィール、プライバシー、ブロック、退会などの節 | iOS `SettingsView.swift` に通知トグル、すれちがい帳、アルバム、旅行プラン、キャンピングカー、トランク、構図一覧、写真キャッシュ | **設定項目の差が明確**。WEBは通知の詳細設定が未実装とコード内で明記。単純なUIコピーは不適切 |
| 投稿/編集 | WEB `app/user/upload/page.tsx` にEXIF抽出、スポット自動選択、S3アップロード、下書き、公開範囲、複数写真の選択 | iOS `UploadView.swift` に下書き復元、スポット紐付け、写真編集、公開範囲、EXIF削除・約1kmへの座標丸めの説明、投稿後SNS共有 | **両方多機能**。公開範囲の既定値、GPS丸め、元画像と編集後画像の扱いを実処理まで追跡する必要あり |
| マイページ/プロフィール編集 | WEB `app/user/profile/page.tsx` はプロフィール編集の画面で、カバー、アバター、名前、自己紹介、テーマ色等を編集 | iOS `MyPageView.swift` は閲覧用マイページで、`ProfileEditView.swift` へ遷移 | **重要：同名に見えるファイルを単純対応させてはいけない**。WEBの `app/user/profile` は編集、iOSの `MyPageView` は閲覧 |
| 旅行 | WEB `app/trips/page.tsx` は `TripsClient` を呼ぶ薄いサーバー側ラッパー | iOS `TripBookView.swift` は旅の一冊の詳細、日別写真・ルート・共有を描画 | **未比較**。WEB `TripsClient` とiOS `TripPlansView` 等を開いて機能を照合する必要あり |
| ホーム | WEB `app/page.tsx` は主にサーバー側ページ構成 | iOS `GalleryView.swift` はフィード切替・おすすめ・空状態・再試行等を描画 | **未比較**。WEBの実際のクライアント側フィードコンポーネントを追跡する必要あり |

### 確認優先度とリスク
1. **P0** 投稿の公開範囲・GPS/EXIF・写真の表示権限。WEB/iOSで実装経路が異なるため、UIが似ていてもセキュリティや公開結果が同じとは限らない。
2. **P1** 写真詳細・共有カード。WEBのURL共有とiOSの画像カード共有の仕様差、バッジ・機材名・余白・枠外出力。
3. **P1** 検索とスポット。絞り込み項目、代表写真の権利表記、取得失敗時の表示。
4. **P1** 設定とプロフィール。画面の実体・ナビゲーションが異なる。機能の有無を決めつけずルート/コンポーネントを追跡。
5. **P2** 旅行・ストーリー・通知・キャンピングカー等の固有機能。WEBへの移植の要否は仕様判断。

### 未実施の検証
- 全画面の全コンポーネントの精読、全操作経路、API呼び出し、スクリーンショット差分、端末実行、回帰テスト。
- 本文はソースコード上の**存在・構造・明記された挙動**のみ。実機の見た目や機能の正常動作を保証しない。

## 第3段階：iOSを正としたコンポーネント深掘り・一次判定

**訂正**：前段階で「ストーリー」「通知」のWEB専用ページが未特定だったことは、機能未実装を意味しない。以下のコンポーネントに実装を確認した。以後、ルートだけでなく子コンポーネント・オーバーレイを必ず調べる。

| 領域 | iOS基準 | WEB実装で実際に確認したこと | 差分の評価 |
| --- | --- | --- | --- |
| ストーリー | `StoryComposerView` / `StoryViewerView` 等 | `app/components/stories/StoriesBar.tsx`（2,222行）に投稿・閲覧・テキスト/スタンプ/位置情報/音楽ツール、既読管理、公開設定等 | **機能あり**。編集ツール・配置・公開範囲・画質の挙動を項目単位で照合 |
| 通知 | `NotificationsView.swift` | `app/components/NotificationsBell.tsx`（1,103行）にベル内一覧・タブ・いいね/コメント/フォロー/ストーリー返信/バッジ/Inspired通知。WEB側のコメントタブはストーリー返信を含む | **機能あり・UI構造が異なる**。WEBのベルUIをiOS独立画面と同一視しない |
| 旅行プラン | `TripPlansView.swift` / `TripBookView.swift` | `app/trips/TripsClient.tsx`（503行）にプラン作成・更新・削除、保存した行きたい場所からの追加、日程編集 | **機能あり**。旅の一冊・ルート・共有・日別表示を次に照合 |
| 下部ナビ | iOSの主要タブ | `app/components/BottomNav.tsx`（296行）にホーム・探す・投稿・マップ・マイページの5タブ、投稿はシートを開く設計 | **機能あり**。モバイルの配置・余白・戻り操作・PCでの表示を比較 |
| 名前横マーク | iOS `NameSideBadgeView` / `ProMark` 等 | `app/components/ProfileNameMarks.tsx`（222行）にProマーク、選択メダル、認証マークの表示規則 | **機能あり**。素材・サイズ・順序・長い名前の折返しを比較 |
| 地図 | iOS `PhotoMapView.swift` | `app/components/PhotoMap.tsx`（825行）にLeaflet地図、写真入りピン、公式スポットの別ピン、現在地の非永続化 | **両方あり・実装方式が異なる**。ピンの重なり・選択・座標保護・読み込み速度を検証 |
| フォロー中のフィード | iOS `GalleryView.swift` のフィード切替 | WEB `app/components/TimelineFeed.tsx`（137行）にフォロー中の写真を新着順で表示 | **機能あり**。フィード切替・ページング・空状態を比較 |
| プロフィールタブ | iOS `ProfileTabBar.swift` に選択下線・スワイプ制御・読み上げ | WEBのプロフィール編集とマイページは別ルート/コンポーネント | **要追跡**。iOSのタブ操作・情報密度・アクセシビリティをWEBの実画面と比較 |

### WEB修正案（未実装・要レビュー）
- **P0**：WEB投稿のEXIF除去・GPS丸め・公開範囲をiOSと同じ結果になるか処理レベルで検証。問題が確認できた箇所のみ修正。
- **P1**：写真詳細と共有のマーク、機材名、レイアウト、写真の余白をiOS基準で照合。
- **P1**：検索・マイページ・設定の画面階層と操作をiOS基準で整理。ただしWEBのURL共有・SEO・PCレイアウトは維持。
- **P2**：ストーリー・通知・旅行の機能別テストケースを作り、iOSとWEBの実装差を明確化。
- **保留**：キャンピングカー・トランク・パス等のWEB対応は、内部コンポーネント/APIの存在を追加検索してから判断。

**検証レベル**：ソースを読んで存在と一部の分岐を確認した段階。全画面の視覚比較、実機操作、APIの完全一致は未完了。

## 第4段階：変更前に守るiOS基準の受け入れ条件

以下を満たさないWEB変更は本番マージしない。**実装済みか否かではなく、iOSと同じ利用結果になるか**を判定する。

| ID | 対象 | iOS基準で検証する操作 | WEBで確認すべき具体的経路 | 合格条件 |
| --- | --- | --- | --- | --- |
| SEC-01 | 投稿 | 位置情報あり/なしのRAW・JPEGを投稿 | `app/user/upload/page.tsx` → `lib/utils/exif` / `image` / `uploadToS3` | 公開画像のEXIF/GPSが意図せず露出せず、保存座標の精度がiOS仕様に整合 |
| SEC-02 | 公開範囲 | 公開・限定・非公開を切替 | 投稿の既定値、API送信、写真詳細、検索/OGP | 限定/非公開写真が公開URL・検索・OGP・関連写真から漏れない |
| SHARE-01 | 共有 | 4:5・9:16・1:1の画像共有 | 写真詳細の `shareUrl` / SNS共有と画像カード出力の有無 | 共有方法の違いを仕様として明示。画像カードならiOSの金縁・余白・撮影者/印・機材・地図・キャッチコピーに準拠 |
| PHOTO-01 | 写真詳細 | 縦横写真、機材名長文、通信失敗、削除済み写真 | `PhotoPageClient.tsx` と `GalleryModal` | 写真の画質を不必要に落とさず、情報の切れ/レイアウト崩れがない |
| PROFILE-01 | マイページ | タブ切替、長い名前、Pro/公式/初期メンバー印 | 公開プロフィールの実コンポーネント、`ProfileNameMarks` | iOSの情報優先順位とバッジ表示規則に一致。WEBの編集画面と閲覧画面を混同しない |
| SEARCH-01 | 検索 | スポット、地域、機材、色、季節、時間帯 | `app/search` 子コンポーネント・`SpotSearchResults` | iOSの発見導線に相当する入口があり、空状態・0件・取得失敗も整合 |
| MAP-01 | 地図 | ピン選択、密集、ズーム、現在地拒否 | `PhotoMap.tsx` | 写真ピンと公式スポットの区別、操作領域、位置情報の扱いを維持 |
| STORY-01 | ストーリー | テキスト/スタンプ/位置/音楽の投稿・閲覧 | `StoriesBar.tsx` と `StoryViewer` | 作成・表示・削除・公開範囲・長文/縦長写真の結果が整合 |
| NOTIF-01 | 通知 | 種別ごとの通知、既読、タブ | `NotificationsBell.tsx` | ストーリー返信をコメントとして扱うなど、通知が消失しない。モバイルは全画面シートでよい |
| TRIP-01 | 旅行 | プラン作成、保存スポット追加、並替・削除 | `TripsClient.tsx` と `useTripPlans` | iOSと同じデータが操作でき、失敗時に復旧できる |
| NAV-01 | タブ | ホーム→写真→人、他人プロフィール、投稿 | `BottomNav.tsx` と `PostSheet` | 5タブの意味・選択状態・投稿導線をiOS基準に維持 |
| A11Y-01 | 全画面 | VoiceOver/キーボード、ダイアログ開閉 | ボタン・dialog・focus trap | 読み上げ名、フォーカス復帰、44px目安の操作領域を確認 |

### 実装上の禁止事項
- 機能が既にあるのに「未実装」と断定して二重実装しない。
- iOSでのみ成立するプッシュ通知・ネイティブ機能を、動かない見せかけのWEBボタンとして追加しない。
- 写真の圧縮/リサイズや位置情報の変更を、画質・プライバシー検証なしに行わない。
- URL共有、SEO、PCレイアウト、キーボード操作をiOSへの見た目寄せで壊さない。
- 監査用ブランチをそのまま本番へマージして機能修正完了と扱わない。

### 実装ブランチに分ける単位
1. `fix/web-ios-photo-share-parity` — 写真詳細と共有カード（画像/レイアウトの検証付き）
2. `fix/web-ios-profile-search-parity` — マイページ/検索（スクリーンショット比較付き）
3. `fix/web-ios-upload-privacy-parity` — 投稿/公開範囲/EXIF（API統合テスト付き）
4. `fix/web-ios-settings-trip-parity` — 設定/旅行（導線と回帰テスト付き）

各PRは差分、影響画面、iOS根拠、テスト、実機/ブラウザ検証、ロールバック手順を必須とする。

## 第5段階：設定画面の行単位照合（iOSを仕様基準）

確認元: WEB `app/user/settings/page.tsx`（613行）、iOS `Sources/JourneyPhoto/Features/Settings/SettingsView.swift`（714行）。

| 項目 | iOSソース | WEBソース | 判断 |
| --- | --- | --- | --- |
| 画面の情報設計 | iOS 143–164行: 目的別に「旅の道具」「お知らせ」「公開範囲とプライバシー」「写真と撮影」等へ分類 | WEB 300–530行: アカウント、プロフィール、プライバシー等が主軸 | **設計差あり**。WEBの機能入口をiOSの分類で再配置する候補 |
| プッシュ通知 | iOS 230–241行: 端末許可状態とトグル、拒否時の設定アプリへの案内 | WEB 19–21行: 通知の詳細設定は機能未実装と明記 | **実装差あり**。WEBは通知ベル自体は実装済みだがプッシュ通知の許可設定と同じではない |
| 旅の道具 | iOS 252–339行: トランク、キャンピングカー、すれちがい帳・乗車券、共同アルバム、旅行プラン | WEB設定には同等の一覧なし。旅行プランは `TripsClient.tsx` に存在 | **入口の差**。機能を作り直さず、既存WEBルートの有無を先に確定 |
| 公開範囲・ブロック | iOS 360–390行: ブロック、親しい友達、トランク公開 | WEB 515–530行: ブロック、親しい友達の導線あり | **一部一致**。トランク公開はWEBに対応するモデル/画面があるか未確認 |
| 写真と撮影 | iOS 393行以降: いいね、構図一覧、データとストレージ | WEB設定 19–21行: ストレージ項目は未提供と説明 | **仕様差あり**。ブラウザキャッシュの管理機能を安易に模倣しない |
| アカウント | iOS 460–492行: ログアウトと削除を別の札にし、誤操作防止 | WEB 474–496行: 全端末ログアウト、582–596行: 削除と確認 | **目的は共通**。全端末ログアウトはiOS通常ログアウトと同一操作ではないため置換禁止 |
| デザイン | iOS 648–687行: 明朝30px見出し、真鍮ラベル、黒背景、54px行 | WEBの現行CSSクラスは未実測 | **視覚差未確定**。スクリーンショットとCSS実値で検証すること |

### 先に直すべきでないもの
- WEBの通知ベルを削除してiOSの独立画面に置き換えること。現行WEBはスマホ全画面シート/PCポップオーバーを明示的に使い分けている。
- WEBの全端末ログアウトをiOSの通常ログアウトと同じラベルにすること。作用範囲が異なる。
- WEBの旅の道具に、動作先が未確認のダミーリンクを増やすこと。

### 次の実装に必要な根拠
1. WEBの設定から到達可能な既存ルートを `lib/routes.ts` と全コンポーネントで確定。
2. iOS `SettingsOutline` の実際の順番・条件付き表示とWEBの表示条件を表で照合。
3. ブラウザ幅390/768/1440、iOS実機でスクリーンショット比較。
4. UI変更PRには設定画面の既存テストとナビゲーション回帰テストを同梱。

**現段階の結論**: 設定は「WEBの機能が全部ない」のではなく、**入口の分類と一部の機能の実装差**が主要な差分。見た目の優劣や本番の正常動作はまだ未判定。
