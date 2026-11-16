import re,json,time,html,os
from k01_kunishitei_lib import *
cand=json.load(open('kcand.json'))
out=json.load(open('kdetail.json')) if os.path.exists('kdetail.json') else {}
for c in cand:
    u=c['url']
    if u in out: continue
    try: h=get(B+u)
    except Exception as e:
        print('ERR',u,e,flush=True); time.sleep(5); continue
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',h,flags=re.S)
    t=html.unescape(re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',t)))
    def f(label):
        m=re.search(label+r' ： (.*?)(?= [^ ]{1,12} ： |$)',t); return m.group(1).strip() if m else ''
    d={k:f(k) for k in ['ふりがな','種別１','種別２','時代','年代','面積','指定年月日','特別指定年月日','指定基準','所在地（市区町村）','所有者種別','その他参考となるべき事項']}
    m=re.search(r'詳細解説 (.*?) (?:関連情報|サイトマップ)',t[t.find('Zoom Mode'):] if 'Zoom Mode' in t else t)
    d['解説']=m.group(1).strip()[:8000] if m else ''
    out[u]=d
    json.dump(out,open('kdetail.json','w'),ensure_ascii=False)
    print(len(out),c['name'],flush=True)
    time.sleep(2.5)
print('DONE')
