# 撮影スポットの束を1つ回す手順（新しいセッション向け）

国内の撮影スポットを、日本語版 Wikipedia の記事と1文ずつ照らして書き、別の担当が反証し、写真を1枚ずつ目で見てから
本番に出すまでの手順。**この文書と `scripts/spot-batch/` だけで、前の会話を知らないセッションが1束（100〜150 件）回せる**
ように書いてある。owner の委任（2026-10-31・rymaruta/journey.photo-ios#410）の範囲で、聞かずに本番まで出してよい。

- 第3束（162 件）・第4束（178 件）・第5束（146 件）をこの手順で出した。台本はそのとき使ったものを名前を付けて置いたもの
- 1束にかかる時間の目安: 候補と記事の取得 約1〜1.5時間、書く＋反証＋直し 約1時間、写真 数時間（Commons が絞るため）、
  検査と反映 約1時間。**文章と写真は分けて出してよい**（第4束・第5束は文章を先に出し、写真を次の束と一緒に出した）

## 目次
0. 始める前に（札・ほかの反映・決まり）
1. 作業用フォルダを作る（s01）
2. 候補を取る・絞る・組に分ける（s02〜s04）
3. 記事を取る（s05〜s07）
4. 書く → 照合 → 反証 → 直す → 二度目の確かめ（担当）
5. 公式サイト・座標を確かめる（s10a・s10b）
6. 台帳へ足す・テスト・文章のコミット（s11・s20）
7. 作例の候補を集める（s12・s13）
8. 写真を落とす・目で見る・反映する（s14〜s17）
9. 検査 → develop → 本番 → 本番で確かめる（s19）
10. #410 に報告する
11. 止まったとき・使用上限に当たったときの続け方
12. 決まりの一覧（破ったことがあるもの）

---

## 0. 始める前に

1. **札**: rymaruta/journey.photo-ios#410 に「作業中」の印を付け、コメントに担当（このセッション）と枝の名前を書く
2. **ほかの反映と重ねない**: journey.photo-ios で「本番に出す」の印の札が開いていないか、photo-gallery の Actions で
   `Deploy Site`・`Deploy API Lambdas` が走っていないかを見る（GitHub MCP の `list_issues`・`actions_list`）。本番に出すのは
   それが終わってから
3. **費用**: Actions は無料枠を超えている見込み（CLAUDE.md）。この手順で使う Actions は本番の Deploy Site（1回 約25分）だけ。
   試しに流すワークフローは無い。費用・データベース・GSI が増える変更はこの手順に含まれない（あれば owner の承認）
4. 作業ツリー: photo-gallery を `git fetch origin develop main` し、`origin/develop` から枝を切る
   （例 `claude/spots-batch6`）。**`npm run verify` を2本同時に流さない**ので、別の検査が走っている作業ツリーでは作業しない

## 1. 作業用フォルダを作る

```bash
export SPOT_BATCH_DIR=/home/user/spot-batch/b6        # 束ごとに新しいフォルダ（中身は git に入れない）
cd <photo-gallery>
python3 scripts/spot-batch/s01_init.py
```

作るもの: 台帳の控え（`ledger_base.json`）・索引（`ledger_index.json`＝既知の QID・名前・座標）・県ごとの既存スポット
（`ledger_nearby/<県>.json`）・前の束で見た候補（`prev_qids.json`＝`scripts/spot-batch/state/seen-qids.json`）・
公開の少ない県の順（`published_by_pref.json`）・道を埋めた指示書（`prompts/`）。

## 2. 候補を取る・絞る・組に分ける

```bash
timeout 1800 python3 scripts/spot-batch/s02_cands.py --lowest 19 > cands.log 2>&1   # 公開の少ない 19 県（約5分）
python3 scripts/spot-batch/s03_filter.py                                           # 県ごとの残りの候補数が出る
python3 scripts/spot-batch/s04_assign.py --groups 4 --per-pref 14
```

- 県は「公開の少ない順」（目標は1県 100 か所）。県を指定するなら `--prefs 長野県,香川県`
- 1県 14 件を渡して 7〜9 件書けるのが目安（約半分は見送りになる）。**19 県 × 14 件 ≒ 266 件 → 書くのは 約150 件**
- 残りの候補が 14 件に満たない県は、その数だけ渡す
- **熊本県は `state/held.json` の 8 件が保留**（2026-07-28 の「令和8年熊本地震」のあと、記事に被害の記述が無く確かめられない）。
  記事が更新されて被害の有無が書かれたら、その行を見直して出す

## 3. 記事を取る

```bash
timeout 7000 python3 scripts/spot-batch/s05_fetch_articles.py > fetch.log 2>&1      # 背景で流す（約1時間）
python3 scripts/spot-batch/s06_snap.py A    # 組 A の分がそろったら articles_A.json を切り出す（そろうまで待つ）
timeout 1800 python3 scripts/spot-batch/s07_coordcheck.py                          # s05 が終わってから
```

- 背景のコマンドは既定 30 分で止められる。**`timeout` を長く付け、Bash の `run_in_background` で流す**
- **取得中に同じ API を叩かない**（curl の疎通確認も2本目になる）
- 組ごとに snap が終わったら、その組の書く担当を始めてよい（全部を待たない）

## 4. 書く → 照合 → 反証 → 直す → 二度目の確かめ

担当への指示文は `$SPOT_BATCH_DIR/prompts/agents.md`（雛形 1〜4）。決まりは `prompts/WRITER.md`・`prompts/REVIEWER.md`。

| 段 | 担当 | 数 | 待ち方 |
|---|---|---|---|
| 書く | 組ごとに1人（雛形1） | 4 | 背景で並べる。終わった組から次へ |
| 照合 | 書く担当が自分で `judge.mjs` を流す | — | 問題0になってから報告が来る |
| 反証 | 組ごとに別の1人（雛形2） | 4 | 書いた組が終わったらすぐ始める |
| 直す | 書いた担当に SendMessage（雛形3） | — | 反証が終わった組から |
| 二度目 | 1人（雛形4） | 1 | 全部の組の直しが終わってから |

- 照合: `SPOT_BATCH_DIR=… node scripts/spot-batch/judge.mjs out/A.json out/B.json out/C.json out/D.json`。
  **組のファイルを全部渡す**（組の間の重なりも見るため）
- 反証の指摘をそのまま渡さず、親が決めること: 見送りに移す行（座標を確かめられない・日帰りで行けるか分からない山）、
  `coordsDoubt` を付ける行、同じ候補が2組に割り当てられたとき（記事の県の組で1回だけ）、名前のそろえ方
- 記事の題と名前が合わない（例「戸隠神社 中社・宝光社」）ときは、記事の中の呼び名と照らして同じ対象と確かめてから
  `subject_ok.json` に slug を足す
- 二度目の確かめの直し（10件前後）は親が自分で入れてよい（文字列の置き換え → judge）
- 第3〜5束の実績: 反証の指摘 誤り 6・直し 68（第5束）、二度目で直し 10。**二度目を飛ばさない**（直しで新しい誤りが入る）

## 5. 公式サイト・座標を確かめる

```bash
python3 scripts/spot-batch/s10a_sitecheck.py out/A.json out/B.json out/C.json out/D.json
python3 scripts/spot-batch/s10b_coordcmp.py  out/A.json out/B.json out/C.json out/D.json
```

- 公式サイト: 題を目で見る。**別の施設のページ（第5束: 西宮神社の欄が神社庁の別の神社の頁）・英語のページ**は
  `sites.json` のその URL を `{"ok": false, "manual": "理由"}` に書き換える。同じサイトへの 301 は行の URL を転送先に直して
  流し直す。404・403・つながらないものは載らない（build が ok だけ載せる）
- 座標: 表に出た行は build が記事の座標を使う。**記事に座標が無く Wikidata も粗い（小数2桁ちょうど・格子ちょうど）行は見送る**
  （`drops.json` に slug と理由。第5束: 東赤石山・医光寺・山形市野草園）

## 6. 台帳へ足す・テスト・文章のコミット

```bash
python3 scripts/spot-batch/s11_build.py out/A.json out/B.json out/C.json out/D.json
npx vitest run lib/data/__tests__ lib/utils/__tests__/spotAutoLink.test.ts     # 台帳のテストと #425 の自動リンク
python3 scripts/spot-batch/s20_record_seen.py                                   # 見た候補の控えを更新
git add content/spots.json scripts/spot-batch/state && git commit
```

- build は毎回 `origin/develop` の台帳に戻してから足す（何度流しても同じ）。既存の行は変えない
- **#425 の `spotAutoLink`（本番の写真48件）が落ちたら**、写真とスポットの結び付きが変わったということ。
  rymaruta/journey.photo-ios#425 に何が変わったかを書く
- 台帳のテストが落ちたら、直すのは行の方（テストの例外を足すのは、日本語として正しいのに見張りが誤って掛かったときだけ。
  第5束: 伊藤若冲の「冲」）
- コミットの本文: 県ごとの件数・見送りの件数と理由の内訳・反証の件数・座標と公式サイトの扱い（第5束の 9cdffac6 が手本）

## 7. 作例の候補を集める

```bash
timeout 7000 node scripts/spot-batch/s12_collect_samples.mjs > collect.log 2>&1   # 背景で流す（146 か所で 約20分）
node scripts/spot-batch/s13_restore_candidates.mjs
git add content/spot-samples.candidates.json && git commit                         # 候補だけ。確定ファイルは目視のあと
```

- s13 は「新しいスポットの分だけ候補を足した形」にし、確定ファイル（`spot-samples.json`）は develop の版に戻す。
  機械が選んだ作例は `samples_before_visual.json` に控える。**見ていない写真は画面に出さない**
- 既存のスポットの候補が1件でも変わっていたら止める（`git diff` で `spots` の中の既存の鍵を突き合わせる）

## 8. 写真を落とす・目で見る・反映する

```bash
timeout 7000 python3 scripts/spot-batch/s14_dl_thumbs.py --max-index 1 > dl.log 2>&1    # まず各スポットの1枚目
python3 scripts/spot-batch/s15_visual_groups.py first --per 27                          # visual/group<N>.json
#   → 目で見る担当（雛形5）を組ごとに1人。並べてよい
timeout 7000 python3 scripts/spot-batch/s14_dl_thumbs.py --max-index 3 > dl2.log 2>&1   # 2・3枚目（目視と並べてよい）
python3 scripts/spot-batch/s15_visual_groups.py rest --per 56                           # visual/pending<N>.json
#   → 2枚目以降の担当（雛形6）
python3 scripts/spot-batch/s16_apply_visual.py           # 確定ファイルと外した写真の一覧を書く
python3 scripts/spot-batch/s17_place_covers.py
npx tsx --import ./scripts/spot-batch/fetch-shim.mjs scripts/promote-sample-covers.ts --slug=$(cat $SPOT_BATCH_DIR/cover_slugs.txt)
node scripts/spot-cover-large.mjs && node scripts/spot-thumbs.mjs --check
```

- Commons の画像サーバーはこの環境の出口を強く絞る（第4束: 要求の約半分が 429・1分に数枚）。1枚目を先に取り、
  2・3枚目は目視と並べて落とす
- **1人に渡すのは 1枚目なら 27 枚・2枚目以降なら 56 枚まで**。多く渡すと途中で画像を開けなくなり、見ずに決める
  （第4束: 81 枚の担当が見ずに決め、全部やり直した）。報告で「見られなかった」「見ずに書いた回があった」と言われたら、
  その組を別の担当で開き直す
- 担当が「確かめられない」「否定しきれない」と書いた写真は親が自分で開いて見て、外す方に倒すなら
  `visual/overrides1.json` に書く（形は s16 の説明）
- 代表写真は fetch-shim で**目で見た手元の画像から置く**（Commons に取り直さない）
- 反映のあと、既存のスポットの作例・代表写真・候補が1件も変わっていないことを機械で突き合わせる
  （`spot-images.json`・`spot-samples.json`・候補の `spots` を develop と比べ、既存の鍵の値が同じか）
- コミット: `content/spot-images.json`・`spot-samples*.json`・`scripts/spot-thumbs.manifest.json`・`public/images/spots`
  （第4束の 7d77ffd3 が手本: か所数・ライセンスの内訳・外した理由の内訳・1,200px の版の数）

## 9. 検査 → develop → 本番 → 本番で確かめる

```bash
rm -rf .next out && timeout 7000 npm run verify > verify.log 2>&1     # 背景で（約25分）。2本同時に流さない
```

1. **全関門 緑**を確かめる。単体テストが1件だけ落ち、それが今回触っていない画面のテストなら、単独で3回と全体をもう一度流して
   全部通ることを確かめ、PR にそう書く（第5束: `CommentSection` が負荷の下で1回落ちた）
2. 枝を push → develop への PR → マージ（`mcp__github__merge_pull_request`）
3. 本番: `git checkout -B <枝>-prod origin/main` → 束のコミットを `git cherry-pick` → この枝でもう一度 `npm run verify`
   → develop と `content/`・`public/images/spots`・`scripts/spot-thumbs.manifest.json` が1バイトも違わないことを
   `git diff origin/develop --stat -- …` で確かめる
4. #410 に「本番に出す」の印を付け、main への PR → マージ → `Deploy Site` が成功するのを待つ（約25分。終わると知らせが来る）
5. `python3 scripts/spot-batch/s19_prodcheck.py`: アプリ向け JSON の国内の行数が「前の数＋足した数」で、新しい行が全部載り、
   新しいページが 200 で名前が本文にあること
6. 「本番に出す」の印を外す

## 10. #410 に報告する

コメントの形（日本語・結論から）:

```
## 第<N>束を本番に出しました（国内 <前> → <後>）
- PR: develop #…・本番 #…・Deploy Site run …（成功）
### 県ごとの件数
| 県 | 件数 | … |
### 確かめたこと
- 記事の全文と1文ずつ照合 → 確かめ役が反証（誤り n・直し n）→ 二度目の確かめ（直し n）
- 座標（記事の座標に替えた行 n・見送り n）・公式サイト（載せなかった n と理由）
- npm run verify 全関門 緑・台帳のテスト・#425 の自動リンク
- 本番: アプリ向け JSON の国内 <n> 行に新しい <n> 行が載っている・新しいページ 200
### 見送ったもの（理由の内訳）
### 確かめていないこと
- 写真（作例・代表写真）は次の束と一緒に出す、など
```

## 11. 止まったとき・使用上限に当たったときの続け方

- **作業用フォルダの中身が状態そのもの**。どの台本も、できている分を飛ばして続きから走る
  （s02: `cands_raw.json` の県、s05: `articles.json` の記事、s07: `wpcoords.json`、s14: `thumbs/` の画像、
  s11: `ids.json` の spotId）
- 担当（Agent）が使用上限で止まったら、上限が戻ってから **SendMessage で同じ担当に「止まったところから続けて」と送る**
  （新しい担当を作らない。途中の結果は担当の出力ファイルに残っている）
- 新しいセッションが途中から引き継ぐときは、作業用フォルダの `out/`・`review/`・`visual/` を見て、どの段まで終わったかを決める
  （`out/<組>.json` があって `review/R<組>.json` が無い → 反証から、など）
- 作業用フォルダはコンテナと一緒に消える。**消える前に、終わった段のコミットを push しておく**（文章・候補・写真は別々の
  コミットでよい）

## 12. 決まりの一覧（破ったことがあるもの）

- Wikimedia（Wikipedia・Wikidata・Commons）は **2秒に1回・1本だけ**。台本の取得を並べて流さない。取得中に curl で叩かない
- 429・5xx は `retry-after` に従う。Commons の検索は HTTP 200 で `cirrussearch-too-busy-error` を返すので待って取り直す
- 画像は **curl** で取る（Python の urllib は1枚 約20秒）。3,000 バイト以下は取れていない扱い
- 背景のコマンドは `timeout` を長く（最大 2 時間）
- 記事の本文を切らない。Wikidata の座標を鵜呑みにしない（記事の座標と突き合わせる）
- 文: 記事に無い事実・数・指定・位置関係・見た目を書かない／混み具合の言い方を出さない／交通・料金・時刻・所要時間を書かない
  （公開期間・開門の時刻は記事どおりなら可）／画面の文に「記事では」「撮りどき」「撮影地」「この場所」「ガイド」「捨てる」を出さない
- **見ていない写真は出さない**
- `aiCheck.delegatedBy` は委任した owner の名前（AI の名前は書けない）。`verifiedBy` は人の確認だけの印で、機械で書かない
- `npm run verify` を2本同時に流さない。別のブランチへ入れる前に緑
- 本番に出す順番は「本番に出す」の印の札で。ほかのセッションの反映と重ねない
- 費用・データベース・GSI が増えるものは owner の承認（この手順には無い）
