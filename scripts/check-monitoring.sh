#!/usr/bin/env bash
#
# check-monitoring.sh — 知らせ（SNS）・アラーム・予算・API の使われ方を**読むだけ**で確かめる
# （2026-11-25・AWS の見直しの 2 と 3。Maintenance の `monitoring-check`）。
#
# 何を出すか:
#   1. API の呼ばれ方（本番の user API・管理 API）。直近 14 日の「1分あたりの呼び出し数」の最大と合計、
#      Lambda の同時に動いた数の最大。流量の上限（`api-user/serverless.yml` の DefaultRouteSettings）の根拠に使う
#   2. 知らせの宛先（SNS のトピック）。名前に journey-photo を含むものと、その購読の**数と状態だけ**
#      🔴 宛先（メールの住所）は出さない（公開のリポジトリの Actions のログに残る）
#   3. アラーム（名前・状態・知らせ先の数）
#   4. AWS Budgets（名前・額・今月の実績と見込み・知らせの数）
#
# 書き込みは一切しない（describe / list / get だけ）。費用は CloudWatch の読み取りの無料の枠の中。
# Cost Explorer は1回 0.01 ドルかかるので呼ばない（今月の実績は Budgets の CalculatedSpend で読む）。
#
# アカウントの番号は `::add-mask::` で伏せる（AWS の見直し 9）。
#
#     使い方:  bash scripts/check-monitoring.sh
#     環境変数: USER_API_ID, ADMIN_API_ID（本番の HTTP API の ID）, AWS_REGION
set -uo pipefail

REGION="${AWS_REGION:-ap-northeast-1}"
USER_API_ID="${USER_API_ID:?USER_API_ID を渡してください}"
ADMIN_API_ID="${ADMIN_API_ID:?ADMIN_API_ID を渡してください}"
DAYS="${DAYS:-14}"

account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
if [ -n "$account" ]; then echo "::add-mask::$account"; fi

section() { echo ""; echo "──────── $1 ────────"; }

# ---------------------------------------------------------------------------
section "1. API の呼ばれ方（直近 ${DAYS} 日・1分ごと）"
# 1分ごとの値は 15 日まで残る。1回に返せる点は 1,440 なので、1日ずつ読む
per_minute() { # per_minute <namespace> <metric> <stat> <dimensions...>
    local ns="$1" metric="$2" stat="$3"; shift 3
    local dir; dir="$(mktemp -d)"
    for d in $(seq "$DAYS" -1 1); do
        local start end
        start="$(date -u -d "-$d days" +%Y-%m-%dT%H:%M:00Z)"
        end="$(date -u -d "-$((d - 1)) days" +%Y-%m-%dT%H:%M:00Z)"
        # 引数で渡すと長すぎて落ちる（1日 1,440 点）ので、日ごとのファイルに置いて最後にまとめて読む
        if ! aws cloudwatch get-metric-statistics --region "$REGION" --namespace "$ns" --metric-name "$metric" \
            --start-time "$start" --end-time "$end" --period 60 --statistics "$stat" "$@" \
            --query "Datapoints[].[Timestamp,$stat]" --output json > "$dir/$d.json" 2> "$dir/err"; then
            echo "  読めませんでした: $(head -c 200 "$dir/err")"; rm -rf "$dir"; return
        fi
    done
    python3 - "$dir" <<'EOF'
import json, sys, glob
pts = []
for f in glob.glob(sys.argv[1] + "/*.json"):
    pts += json.load(open(f))
if not pts:
    print("  点がありません（呼ばれていない）"); sys.exit()
vals = sorted(v for _, v in pts)
top = sorted(pts, key=lambda p: -p[1])[:5]
def pct(q): return vals[min(len(vals) - 1, int(len(vals) * q))]
total = sum(vals)
print(f"  点 {len(vals)}（呼ばれた分）  合計 {total:.0f}  最大 {vals[-1]:.0f}/分  99% {pct(0.99):.0f}/分  中央 {pct(0.5):.0f}/分")
print("  多かった分: " + ", ".join(f"{t[:16]}Z {v:.0f}" for t, v in top))
EOF
    rm -rf "$dir"
}
echo "user API（本番）の呼び出し数:"
per_minute AWS/ApiGateway Count Sum --dimensions Name=ApiId,Value="$USER_API_ID"
echo "user API（本番）の 5xx:"
per_minute AWS/ApiGateway 5xx Sum --dimensions Name=ApiId,Value="$USER_API_ID"
echo "user API（本番）の 4xx（429 を含む）:"
per_minute AWS/ApiGateway 4xx Sum --dimensions Name=ApiId,Value="$USER_API_ID"
echo "管理 API（本番）の呼び出し数:"
per_minute AWS/ApiGateway Count Sum --dimensions Name=ApiId,Value="$ADMIN_API_ID"
echo "Lambda の同時に動いた数（地域の全部・1分の最大）:"
per_minute AWS/Lambda ConcurrentExecutions Maximum
echo "Bedrock の呼び出し数（Nova Lite）:"
per_minute AWS/Bedrock Invocations Sum --dimensions Name=ModelId,Value=amazon.nova-lite-v1:0

# ---------------------------------------------------------------------------
section "2. 知らせの宛先（SNS）"
topics="$(aws sns list-topics --region "$REGION" --query 'Topics[].TopicArn' --output text 2>&1)" || { echo "  読めませんでした: ${topics:0:200}"; topics=""; }
found=0
for arn in $topics; do
    case "$arn" in *journey-photo*|*photo-gallery*) ;; *) continue ;; esac
    found=1
    name="${arn##*:}"
    subs="$(aws sns list-subscriptions-by-topic --region "$REGION" --topic-arn "$arn" \
        --query 'Subscriptions[].[Protocol, SubscriptionArn]' --output text 2>/dev/null || true)"
    # 宛先（Endpoint）は読まない。確かめ待ちは SubscriptionArn が PendingConfirmation になる
    confirmed="$(printf '%s\n' "$subs" | awk 'NF && $2 != "PendingConfirmation"' | wc -l | tr -d ' ')"
    pending="$(printf '%s\n' "$subs" | awk 'NF && $2 == "PendingConfirmation"' | wc -l | tr -d ' ')"
    protos="$(printf '%s\n' "$subs" | awk 'NF {print $1}' | sort | uniq -c | awk '{printf "%s %s件 ", $2, $1}')"
    echo "  $name  購読: 確かめ済み ${confirmed} / 確かめ待ち ${pending}  ${protos}"
done
[ "$found" = 1 ] || echo "  journey-photo・photo-gallery の名前のトピックはありません"

# ---------------------------------------------------------------------------
section "3. アラーム"
# 知らせ先はトピックの名前だけ出す（ARN にはアカウントの番号が入る）
aws cloudwatch describe-alarms --region "$REGION" --output json 2>&1 | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("  読めませんでした"); sys.exit()
for a in d.get("MetricAlarms", []):
    acts = ", ".join(x.rsplit(":", 1)[-1] for x in a.get("AlarmActions", [])) or "なし"
    print(f"  {a[\"AlarmName\"]:<60} {a[\"StateValue\"]:<18} 知らせ先 {acts}")
'
echo "  （数: $(aws cloudwatch describe-alarms --region "$REGION" --query 'length(MetricAlarms)' --output text 2>/dev/null || echo '?')）"

# ---------------------------------------------------------------------------
section "4. AWS Budgets"
if [ -z "$account" ]; then
    echo "  アカウントを読めないので飛ばします"
else
    budgets="$(aws budgets describe-budgets --account-id "$account" --output json 2>&1)" || { echo "  読めませんでした: ${budgets:0:200}" | sed "s/$account/<acct>/g"; budgets='{"Budgets":[]}'; }
    names="$(python3 - "$budgets" <<'EOF'
import json, sys
d = json.loads(sys.argv[1])
bs = d.get("Budgets", [])
if not bs:
    print("  予算はありません", file=sys.stderr)
for b in bs:
    lim = b.get("BudgetLimit", {})
    cs = b.get("CalculatedSpend", {})
    act = cs.get("ActualSpend", {}); fc = cs.get("ForecastedSpend", {})
    filt = b.get("CostFilters") or {}
    print(f"  {b['BudgetName']}  {b.get('BudgetType')} {b.get('TimeUnit')}  額 {lim.get('Amount')} {lim.get('Unit')}  "
          f"今月の実績 {act.get('Amount', '?')} {act.get('Unit', '')}  見込み {fc.get('Amount', '?')} {fc.get('Unit', '')}  "
          f"絞り {json.dumps(filt, ensure_ascii=False) if filt else 'なし（全体）'}", file=sys.stderr)
    print(b["BudgetName"])
EOF
)"
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        echo "    $name の知らせ:"
        notes="$(aws budgets describe-notifications-for-budget --account-id "$account" --budget-name "$name" --output json 2>/dev/null || echo '{}')"
        python3 -c 'import json,sys; [print(json.dumps(n)) for n in json.loads(sys.argv[1]).get("Notifications", [])]' "$notes" \
        | while IFS= read -r note; do
            # 宛先はメールなら「EMAIL」とだけ、SNS ならトピックの名前だけ出す（住所・アカウントの番号は出さない）
            subs="$(aws budgets describe-subscribers-for-notification --account-id "$account" --budget-name "$name" \
                --notification "$note" --output json 2>/dev/null \
                | python3 -c 'import json,sys; d=json.load(sys.stdin); print(", ".join(s["SubscriptionType"] + (" " + s["Address"].rsplit(":",1)[-1] if s["SubscriptionType"]=="SNS" else "") for s in d.get("Subscribers", [])) or "なし")' 2>/dev/null || echo '?')"
            desc="$(python3 -c 'import json,sys; n=json.loads(sys.argv[1]); print(n["NotificationType"], n["ComparisonOperator"], n["Threshold"], n.get("ThresholdType",""))' "$note")"
            echo "      $desc  宛先: $subs"
        done
    done <<< "$names"
fi

echo ""
echo "読むだけで終わりました（何も変えていません）"
