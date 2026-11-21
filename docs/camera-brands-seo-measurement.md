# カメラメーカー比較記事のGSC・GA4確認（PR #681）

対象URL: https://journey-photo.com/learn/camera-brands

## Google Search Console（検索流入）
- [ ] 本番公開後、URL検査でインデックス登録状況とGoogleが選択した正規URLを確認する
- [ ] /sitemap-learn.xml に対象URLが含まれ、lastmodが本文の更新日と一致することを確認する
- [ ] 検索パフォーマンス > ページで対象URLに絞り、クリック数・表示回数・CTR・平均掲載順位を見る
- [ ] 同じ画面の「クエリ」で「カメラメーカー 比較」「カメラメーカー おすすめ」等の実際の流入語を確認する
- [ ] 公開後28日と次の28日を比較する。検索順位やクリック数の増加は保証されない
- [ ] GSCの確認タグは NEXT_PUBLIC_GSC_VERIFICATION が設定されている場合にのみ出力される。GSCプロパティの所有権・アクセス権は別途確認する

## GA4（サイト内行動）
- [ ] 本番環境に NEXT_PUBLIC_GA_ID が設定され、NEXT_PUBLIC_PLAUSIBLE_DOMAIN が優先されていないことを確認する
- [ ] GA4 > レポート > エンゲージメント > ページとスクリーンで /learn/camera-brands を絞る（ページビュー、ユーザー、平均エンゲージメント時間）
- [ ] GA4 DebugView またはリアルタイムで記事からリンクをクリックし、learn_link_click イベントを確認する
- [ ] learn_link_click のパラメータ article と target をイベントスコープのカスタムディメンションとして登録する（登録前の値は標準レポートで遡及表示されない）
- [ ] target は brand_official / camera_examples / camera_basics / brand_jump の固定値のみ。URL、メーカー名、ユーザー情報は送らない
- [ ] 内部リンククリック数と、遷移先の閲覧数は一致しない（ブロッカー、通信、離脱、タグ読み込みタイミングなど）
- [ ] GA4のタグは lazyOnload。読み込み前に離脱したユーザーは測定できない場合がある
- [ ] 記事のPVは既存のgtag configに任せ、独自のpage_viewを追加して二重計測しない

## 注意
GSCはGoogle検索での露出を測り、GA4はサイトに来た後の閲覧・クリックを測る。両者のクリック数とセッション数は一致しない。アクセス解析の設定・Google側のプロパティ接続はコード変更だけでは完了しない。
