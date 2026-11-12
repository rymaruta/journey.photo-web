#!/usr/bin/env bash
# APNs の鍵（.p8 の中身・改行を含む）を、serverless の `--param` に渡せる1行にする。
#
# 🔴 **改行のまま `--param "apnsPrivateKey=$APNS_PRIVATE_KEY"` と渡すと、1行目しか届かない。**
# serverless v3 の `--param` は `@serverless/dashboard-plugin` の
# `/(?<key>[^=]+)=(?<value>.+)/` で読まれ、`.` は改行に当たらないので、値は
# `-----BEGIN PRIVATE KEY-----`（27文字）で切れる。2026-11-12 に本番・staging の
# 送る関数が全部 27 文字で、`sendPush` が `DECODER routines::unsupported` で落ちていた
# （札 journey.photo-ios#585）。
#
# そこで改行を `\n`（2文字）に置き換えて渡す。戻すのは `api-user/src/apns.ts` の
# `PRIVATE_KEY`（`.replace(/\\n/g, "\n")`）。
#
# **配る前の見張り**: 鍵が 200 文字未満か、BEGIN と END の両方を含まないなら、
# 何も出さずに 1 で終わる（デプロイを止める）。
#
# 使い方: APNS_PRIVATE_KEY=... bash scripts/apns-key-param.sh
#   標準出力 … `--param` に渡す1行（値なので**ログに出さない**こと）
#   標準エラー … 長さ・改行の数・BEGIN/END の有無だけ（値は出さない）
set -euo pipefail

key="${APNS_PRIVATE_KEY:-}"
# Windows で保存した .p8 を貼った回に備えて CR を落とす
key="${key//$'\r'/}"

nl="${key//[^$'\n']/}"
has_begin=no; has_end=no
[[ "$key" == *"-----BEGIN "* ]] && has_begin=yes
[[ "$key" == *"-----END "* ]] && has_end=yes
echo "APNs の鍵: ${#key} 文字・改行 ${#nl} 個・BEGIN ${has_begin}・END ${has_end}" >&2

if (( ${#key} < 200 )) || [[ $has_begin != yes || $has_end != yes ]]; then
  echo "::error::APNs の鍵（secrets.APNS_PRIVATE_KEY）が壊れています（200 文字未満か、BEGIN と END の両方がない）。.p8 の中身を BEGIN の行から END の行まで丸ごと入れ直してください。配らずに止めます。" >&2
  exit 1
fi

escaped="${key//$'\n'/\\n}"
printf '%s' "$escaped"
