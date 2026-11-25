#!/usr/bin/env python3
"""
align-alerts.py — 手で作ってあった予算とアラームを、知らせの宛先（SNS）にそろえる
（2026-11-25・AWS の見直し 3。Maintenance の `align-alerts`。既定は下見、`--apply` で変える）。

前提: 知らせの宛先 `journey-photo-alerts-prod`（`api/monitoring.yml`）が本番の反映で先にできていること。

やること（どれも**戻せる・データを消さない**）:
  1. AWS Budgets（もうある2つ。作り直さない・額は変えない）
     - 全体の予算（絞りなし）と Bedrock の予算（Service に Amazon Bedrock を含む）について、
       「実績が 80% を越えた」「実績が 100% を越えた」の知らせが無ければ足す
       （宛先は、その予算の今の知らせのメールの宛先と同じ ＋ SNS）
     - 今ある知らせのどれにも、SNS の宛先を足す（メールの宛先はそのまま残す）
     戻すとき: `aws budgets delete-subscriber` / `delete-notification`
  2. 古いアラーム（`Lambda-Errors-photo-gallery-*`。手で作った関数ごとの6つ）を消す。
     `api/monitoring.yml` の「Lambda のエラー（全部の関数）」と「API の 5xx」が同じものを見る。
     残すとアラームの数が無料の枠（10）を大きく越える（月 0.9 ドル）。
     消す前に定義を全部ログに出す（`aws cloudwatch put-metric-alarm --cli-input-json` でそのまま作り直せる）
  3. 古い宛先 `journey-photo-alerts`（購読 0）を、購読が無く、どのアラームも指していなければ消す
     戻すとき: `aws sns create-topic --name journey-photo-alerts`

🔴 メールの住所は**ログに出さない**（公開のリポジトリ）。メールの宛先は「EMAIL」とだけ書く。
   アカウントの番号は `::add-mask::` で伏せる。

使い方:
  python3 scripts/align-alerts.py           # 下見（何も変えない）
  python3 scripts/align-alerts.py --apply   # 変える
"""
import json
import subprocess
import sys

REGION = "ap-northeast-1"
TOPIC_NAME = "journey-photo-alerts-prod"
LEGACY_TOPIC = "journey-photo-alerts"
LEGACY_ALARM_PREFIX = "Lambda-Errors-photo-gallery-"
REQUIRED = [80.0, 100.0]  # 実績（ACTUAL）がこの % を越えたら知らせる

APPLY = "--apply" in sys.argv[1:]


def aws(*args, parse=True):
    out = subprocess.run(["aws", *args, "--output", "json"], check=True, capture_output=True, text=True).stdout
    return json.loads(out) if parse and out.strip() else {}


def change(desc, *args):
    """下見なら書くだけ、--apply なら実行する"""
    print(("  変える: " if APPLY else "  （下見）変える予定: ") + desc)
    if APPLY:
        aws(*args, parse=False)


def budget_kind(b):
    filt = b.get("CostFilters") or {}
    if not filt:
        return "total"
    if "Amazon Bedrock" in (filt.get("Service") or []):
        return "bedrock"
    return None


def sub_label(s):
    return "EMAIL" if s["SubscriptionType"] == "EMAIL" else "SNS " + s["Address"].rsplit(":", 1)[-1]


def main():
    account = aws("sts", "get-caller-identity")["Account"]
    print(f"::add-mask::{account}")
    print("下見です（何も変えません）。変えるときは apply を true に" if not APPLY else "変えます（apply）")

    topic_arn = f"arn:aws:sns:{REGION}:{account}:{TOPIC_NAME}"
    try:
        aws("sns", "get-topic-attributes", "--region", REGION, "--topic-arn", topic_arn)
    except subprocess.CalledProcessError:
        print(f"宛先 {TOPIC_NAME} がまだありません。先に本番の反映（Deploy API Lambdas の管理 API のジョブ）を通してください")
        sys.exit(1)
    print(f"宛先: {TOPIC_NAME}")

    # ---- 1. 予算 ---------------------------------------------------------------
    print("\n── 1. 予算 ──")
    budgets = aws("budgets", "describe-budgets", "--account-id", account).get("Budgets", [])
    seen = set()
    for b in budgets:
        kind = budget_kind(b)
        name = b["BudgetName"]
        if kind is None:
            print(f"{name}: 全体でも Bedrock でもないので触りません")
            continue
        seen.add(kind)
        print(f"{name}（{'全体' if kind == 'total' else 'Bedrock'}・額 {b['BudgetLimit']['Amount']} {b['BudgetLimit']['Unit']}）")
        notes = aws("budgets", "describe-notifications-for-budget", "--account-id", account, "--budget-name", name).get("Notifications", [])
        emails = []
        for n in notes:
            subs = aws("budgets", "describe-subscribers-for-notification", "--account-id", account,
                       "--budget-name", name, "--notification", json.dumps(n)).get("Subscribers", [])
            print(f"  今の知らせ: {n['NotificationType']} {n['ComparisonOperator']} {n['Threshold']}  宛先: {', '.join(sub_label(s) for s in subs) or 'なし'}")
            for s in subs:
                if s["SubscriptionType"] == "EMAIL" and s not in emails:
                    emails.append(s)
            if not any(s["SubscriptionType"] == "SNS" and s["Address"] == topic_arn for s in subs):
                change(f"{name} の {n['NotificationType']} {n['Threshold']}% に宛先 SNS {TOPIC_NAME} を足す",
                       "budgets", "create-subscriber", "--account-id", account, "--budget-name", name,
                       "--notification", json.dumps(n),
                       "--subscriber", json.dumps({"SubscriptionType": "SNS", "Address": topic_arn}))
        for th in REQUIRED:
            has = any(n["NotificationType"] == "ACTUAL" and n["ComparisonOperator"] == "GREATER_THAN"
                      and float(n["Threshold"]) == th and n.get("ThresholdType", "PERCENTAGE") == "PERCENTAGE" for n in notes)
            if has:
                continue
            note = {"NotificationType": "ACTUAL", "ComparisonOperator": "GREATER_THAN", "Threshold": th, "ThresholdType": "PERCENTAGE"}
            subs = emails + [{"SubscriptionType": "SNS", "Address": topic_arn}]
            change(f"{name} に「実績が {th:.0f}% を越えた」の知らせを足す（宛先: {', '.join(sub_label(s) for s in subs)}）",
                   "budgets", "create-notification", "--account-id", account, "--budget-name", name,
                   "--notification", json.dumps(note), "--subscribers", json.dumps(subs))
    for kind in ("total", "bedrock"):
        if kind not in seen:
            print(f"⚠️ {'全体' if kind == 'total' else 'Bedrock'} の予算がありません（このスクリプトは作りません。owner に頼む）")

    # ---- 2. 古いアラーム ---------------------------------------------------------
    print("\n── 2. 古いアラーム（関数ごと・手で作ったもの） ──")
    alarms = aws("cloudwatch", "describe-alarms", "--region", REGION, "--alarm-name-prefix", LEGACY_ALARM_PREFIX).get("MetricAlarms", [])
    if not alarms:
        print("  ありません")
    keep = {"AlarmName", "AlarmDescription", "ActionsEnabled", "OKActions", "AlarmActions", "InsufficientDataActions",
            "MetricName", "Namespace", "Statistic", "ExtendedStatistic", "Dimensions", "Period", "Unit",
            "EvaluationPeriods", "DatapointsToAlarm", "Threshold", "ComparisonOperator", "TreatMissingData", "Metrics"}
    for a in alarms:
        spec = {k: v for k, v in a.items() if k in keep}
        print(f"  {a['AlarmName']}  作り直すときの定義: {json.dumps(spec, ensure_ascii=False)}")
    if alarms:
        names = [a["AlarmName"] for a in alarms]
        change(f"古いアラーム {len(names)} 個を消す（全部の関数と口を見るアラームに置き換え済み）",
               "cloudwatch", "delete-alarms", "--region", REGION, "--alarm-names", *names)

    # ---- 3. 古い宛先 -------------------------------------------------------------
    print("\n── 3. 古い宛先 ──")
    legacy_arn = f"arn:aws:sns:{REGION}:{account}:{LEGACY_TOPIC}"
    try:
        subs = aws("sns", "list-subscriptions-by-topic", "--region", REGION, "--topic-arn", legacy_arn).get("Subscriptions", [])
    except subprocess.CalledProcessError:
        print(f"  {LEGACY_TOPIC} はありません")
        return
    legacy_names = {a["AlarmName"] for a in alarms}
    all_alarms = aws("cloudwatch", "describe-alarms", "--region", REGION).get("MetricAlarms", [])
    users = [a["AlarmName"] for a in all_alarms if a["AlarmName"] not in legacy_names
             and legacy_arn in (a.get("AlarmActions", []) + a.get("OKActions", []) + a.get("InsufficientDataActions", []))]
    if subs or users:
        print(f"  {LEGACY_TOPIC} は購読 {len(subs)}・指すアラーム {len(users)} があるので残します")
    else:
        change(f"{LEGACY_TOPIC}（購読 0・指すアラームなし）を消す", "sns", "delete-topic", "--region", REGION, "--topic-arn", legacy_arn)

    print("\n終わりました" + ("（変えました）" if APPLY else "（下見だけ。何も変えていません）"))


if __name__ == "__main__":
    main()
