"""段10a: 公式サイトを確かめる（https・2xx・転送されない・<title>）→ sites.json。build は ok の URL だけ載せる。

  python3 scripts/spot-batch/s10a_sitecheck.py out/A.json out/B.json …
転送（301）は転送先が同じサイトなら、行の URL を転送先に直して流し直す。題が別の施設・英語のページは
sites.json のその URL を {"ok": false, "manual": "理由"} に手で書き換える（第5束: 西宮神社の欄が別の神社の頁だった）。
接続が切れた（Connection reset）ものは sites.json から消して少し後に流し直す。
"""
import json, sys, urllib.request, html, re, os
import urllib.error
from batchlib import CTX, work_dir
work_dir()
class NoRedir(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None
op=urllib.request.build_opener(NoRedir,urllib.request.HTTPSHandler(context=CTX))
res=json.load(open('sites.json')) if os.path.exists('sites.json') else {}
rows=[r for f in sys.argv[1:] for r in json.load(open(f))['rows'] if r.get('officialWebsiteUrl')]
for r in rows:
    u=r['officialWebsiteUrl']
    if u in res: continue
    out={'ok':False}
    try:
        req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0 (compatible; JourneyPhotoSpotCheck/1.0; +https://journey-photo.com)'})
        with op.open(req,timeout=25) as resp:
            body=resp.read(400000)
            cs=resp.headers.get_content_charset() or ('shift_jis' if b'shift_jis' in body[:2000].lower() or b'sjis' in body[:2000].lower() else 'euc-jp' if b'euc-jp' in body[:2000].lower() else 'utf-8')
            t=body.decode(cs,'replace')
            m=re.search(r'<title[^>]*>(.*?)</title>',t,re.S|re.I)
            out={'ok':200<=resp.status<300,'status':resp.status,'title':html.unescape(re.sub(r'\s+',' ',m.group(1))).strip() if m else ''}
    except urllib.error.HTTPError as e:
        out={'ok':False,'status':e.code,'location':e.headers.get('location')}
    except Exception as e:
        out={'ok':False,'error':str(e)[:120]}
    res[u]=out; print(r['slug'],u,out,flush=True)
    json.dump(res,open('sites.json','w'),ensure_ascii=False,indent=1)
