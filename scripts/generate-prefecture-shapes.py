#!/usr/bin/env python3
"""ホームの日本地図（`app/components/HomeJapanMap.tsx`）の県の形を作る。

Usage: python3 scripts/generate-prefecture-shapes.py <japan-prefectures.json> > lib/data/prefectureShapes.ts

入力: journey.photo-ios の `Sources/JourneyPhoto/Resources/japan-prefectures.json`
      （47県・Natural Earth ne_10m_admin_1 のパブリックドメイン・0.01° で間引き済み。
      作る側は iOS の `Tools/generate-japan-prefectures.py`）。形の出どころを iOS と1本にする。
出力: `lib/data/prefectureShapes.ts`（生成物・コミットする）。外部の Python パッケージは使わない。

2026-11-09 判断（デザイナーの提案書・案D の試作と同じ変換。owner「任せる」）:
- 経度に cos36° を掛けた平面 → 幅 360 の viewBox（本土の外接箱が 360 幅）
- 0.3（viewBox の単位）の RDP で間引く・相対座標・小数 1 桁（パスだけで約 21KB）
- 沖縄は枠に入れて右下の太平洋へ動かす。**縮尺は本土と同じ 1.0 倍**（1.7 倍にすると枠が 300px 近くなり本土を押しのける）
- 小笠原（東京都の緯度 30 未満）は除く（遠すぎて地図が縦に伸びる）
- 2.2 未満の小さな島は落とす（その県のいちばん大きい輪は必ず残す）
"""
import json, math, re, sys, collections

SRC = sys.argv[1]
HERE = __import__("os").path.dirname(__import__("os").path.abspath(__file__))
G = json.load(open(SRC, encoding="utf-8"))
pref_ts = open(__import__("os").path.join(HERE, "..", "lib", "data", "prefectures.ts"), encoding="utf-8").read()
SLUG = {n: s for n, s, r in re.findall(r'\{ name: "([^"]+)", slug: "([a-z]+)", nameEn: "[^"]+", region: "([^"]+)" \}', pref_ts)}
assert len(G) == 47 and len(SLUG) == 47, (len(G), len(SLUG))

COS = math.cos(math.radians(36))
W = 360.0
EPS = 0.3
MIN_ISLAND = 2.2

rings = []
for g in G:
    for r in g["r"]:
        lat = sum(p[1] for p in r) / len(r)
        if g["n"] == "東京都" and lat < 30:
            continue
        rings.append((g["n"], r))

def ext(rs):
    xs = [p[0] for _, r in rs for p in r]; ys = [p[1] for _, r in rs for p in r]
    return min(xs), max(xs), min(ys), max(ys)

main = [x for x in rings if x[0] != "沖縄県"]
lon0, lon1, lat0, lat1 = ext(main)
oki = [x for x in rings if x[0] == "沖縄県"]
olon0, olon1, olat0, olat1 = ext(oki)
S = W / ((lon1 - lon0) * COS)

def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    md, mi = -1, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L if L else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > md:
            md, mi = d, i
    if md > eps:
        return rdp(pts[:mi + 1], eps)[:-1] + rdp(pts[mi:], eps)
    return [a, b]

def area(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2

def fmt(v):
    t = f"{v:.1f}"
    if t.endswith(".0"):
        t = t[:-2]
    if t.startswith("0."):
        t = t[1:]
    if t.startswith("-0."):
        t = "-" + t[2:]
    return t

def rel(q):
    s = "M" + fmt(q[0][0]) + " " + fmt(q[0][1])
    px, py = round(q[0][0], 1), round(q[0][1], 1)
    parts = []
    for x, y in q[1:]:
        x, y = round(x, 1), round(y, 1)
        parts.append(fmt(x - px) + " " + fmt(y - py))
        px, py = x, y
    return s + ("l" + " ".join(parts)).replace(" -", "-") + "z"

okw = (olon1 - olon0) * COS * S
okh = (olat1 - olat0) * S
FX, FY = W - okw - 4, 346.0
H = round(FY + okh + 6, 1)
FRAME = [round(FX, 1), round(FY, 1), round(okw, 1), round(okh, 1)]

def proj(p):
    return ((p[0] - lon0) * COS * S, (lat1 - p[1]) * S)

def proj_ok(p):
    return ((p[0] - olon0) * COS * S + FX, (olat1 - p[1]) * S + FY)

by = collections.OrderedDict((g["n"], []) for g in G)
for n, r in rings:
    by[n].append([(proj_ok if n == "沖縄県" else proj)(p) for p in r])

out = []
for n, rs in by.items():
    rs = sorted(rs, key=lambda r: -area(r))
    d, allp = "", []
    for k, r in enumerate(rs):
        xs = [p[0] for p in r]; ys = [p[1] for p in r]
        if k > 0 and (max(xs) - min(xs) < MIN_ISLAND and max(ys) - min(ys) < MIN_ISLAND):
            continue
        q = rdp(r, EPS)
        if len(q) < 4:
            continue
        d += rel(q); allp += q
    xs = [p[0] for p in allp]; ys = [p[1] for p in allp]
    big = rs[0]
    cx = sum(p[0] for p in big) / len(big); cy = sum(p[1] for p in big) / len(big)
    out.append((SLUG[n], d, [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)], [cx, cy]))

def n1(v):
    return fmt(v) if fmt(v) not in ("", "-") else "0"

lines = []
lines.append("// lib/data/prefectureShapes.ts（**生成物**・手で直さない）")
lines.append("//")
lines.append("// ホームの日本地図（`app/components/HomeJapanMap.tsx`）の47県の形。作り方は `scripts/generate-prefecture-shapes.py`")
lines.append("// （`python3 scripts/generate-prefecture-shapes.py <iOS の japan-prefectures.json> > lib/data/prefectureShapes.ts`）。")
lines.append("// 出どころは Natural Earth（パブリックドメイン）。変換の判断はスクリプトの冒頭。")
lines.append("//")
lines.append("// shape = [スラッグ, パス d, 外接箱 [x, y, w, h], 重心 [x, y]]。単位は viewBox（幅 360）。")
lines.append("// 重心はその県のいちばん大きい輪のもの（矢印キーの隣と「近くの県」に使う）。")
lines.append("")
lines.append(f"export const MAP_W = {int(W)};")
lines.append(f"export const MAP_H = {H};")
lines.append(f"/** 沖縄の枠 [x, y, w, h]（本土と同じ縮尺で右下に置く） */")
lines.append(f"export const OKINAWA_FRAME: readonly [number, number, number, number] = [{', '.join(n1(v) for v in FRAME)}];")
lines.append("")
lines.append("export type PrefectureShape = readonly [slug: string, d: string, box: readonly [number, number, number, number], center: readonly [number, number]];")
lines.append("")
lines.append("export const PREFECTURE_SHAPES: readonly PrefectureShape[] = [")
for slug, d, box, c in out:
    lines.append(f'    ["{slug}", "{d}", [{", ".join(n1(v) for v in box)}], [{", ".join(n1(v) for v in c)}]],')
lines.append("];")
print("\n".join(lines))
