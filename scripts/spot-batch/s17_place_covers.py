"""段17: 代表写真を置く準備。目視に使った手元の縮小版を Commons の URL に対応づけ（local_map.json）、
代表写真を付けるスポットの slug を cover_slugs.txt に書く。続けて手順書の段17のコマンドを流す:

  npx tsx --import ./scripts/spot-batch/fetch-shim.mjs scripts/promote-sample-covers.ts --slug=$(cat $SPOT_BATCH_DIR/cover_slugs.txt)
  node scripts/spot-cover-large.mjs && node scripts/spot-thumbs.mjs --check

fetch-shim.mjs が手元の画像を答えにするので、Commons に取り直さない（目で見たのと同じ画像が置かれる）。
"""
import os

from batchlib import load, save, work_dir

work_dir()
S = load("samples_before_visual.json")
m = {}
for sid, e in S.items():
    for i, s in enumerate(e["samples"]):
        p = f"thumbs/{sid}/{i}.jpg"
        if os.path.exists(p) and os.path.getsize(p) > 3000:
            m[s["thumbUrl"]] = os.path.abspath(p)
save("local_map.json", m, indent=None)
C = load("final_covers.json")
with open("cover_slugs.txt", "w") as f:
    f.write(",".join(C))
print("手元の画像", len(m), "・代表写真を付ける", len(C), "か所")
