"""段3: 候補を絞る（種類の許可・除外、前に見た候補、台帳と同じ QID・名前・500m 以内を落とす）。

  python3 scripts/spot-batch/s03_filter.py   → cands_f.json（県ごとに言語版の多い順）
"""
from batchlib import work_dir
import json, re, math
work_dir(); raw=json.load(open('cands_raw.json'))
PREV=set(json.load(open('prev_qids.json'))); L=json.load(open('ledger_index.json'))
Q=set(L['qids']); N=set(L['names']); P=L['pts']
def norm(x): return re.sub(r'[\s・（）()「」]','',x)
WL=['寺','神社','社','宮','滝','山','岳','湖','沼','池','公園','城','峡','渓谷','海岸','浜','岬','島','温泉','庭園','展望','橋','灯台','棚田','高原','湿原','洞','崖','半島','丘','湾','植物園','町並み','伝統的建造物群','史跡','名勝','天然記念物','峠','砂丘','森','並木','遺跡','石垣','火山','カルデラ','火口','鍾乳','砂浜','ビーチ','磯','渓流','奇岩','岩','花','桜','庭','塔','教会','聖堂','大仏','仏像','宿場','街道','海水浴場','ダム','運河','港']
BL=['国立公園','国定公園','県立自然公園','海峡','半島','諸島','列島','遺跡群','構成資産','世界遺産','水道','灘','海域','ラムサール','山地','高地','平野','盆地','ダム湖','重力式','アーチ式','ロックフィル','駅','大学','学校','病院','道路','日本の市','日本の町','日本の村','日本の区','郡','山脈','事件','地震','選挙区','ホテル','スタジアム','発電所','競','空港','高速','鉄道路線','都市','研究所','警察','大字','町丁','企業','会社','戦い','合戦','川','派川','トンネル','インターチェンジ','サービスエリア','パーキングエリア','道の駅','ショッピング','野球','サッカー','アリーナ','球場','体育館','図書館','役所','庁舎','刑務所','基地','飛行場','国分尼寺']
def dist(a,b,c,d):
    R=6371;p=math.pi/180
    x=(d-b)*p*math.cos((a+c)/2*p); y=(c-a)*p
    return R*math.hypot(x,y)
out={}
for pref,items in raw.items():
    keep=[]
    seen=set()
    for it in items:
        if it['qid'] in seen or it['title'] in ('竹島','竹島 (島根県)','尖閣諸島','北方領土'): continue
        seen.add(it['qid'])
        if it['qid'] in PREV: continue
        if re.search(r'(戦い|合戦|火災|事件|教区|群島|カルデラ|宇宙センター|観測所|遺産|鉱山跡地|の金山)$',re.sub(r'\s*\(.*?\)$','',it['title'])) or it['title'] in ('北海道','硫黄島 (東京都)','南鳥島','沖ノ鳥島','西之島','北硫黄島','南硫黄島','摺鉢山 (東京都)'): continue
        b0=re.sub(r'\s*\(.*?\)$','',it['title'])
        if re.search(r'(湾|海|国立公園|国定公園|半島|諸島|列島|ダム|事件|遺跡群|の社寺)$',b0) or (b0.endswith('海岸') and it['n']>12): continue
        t=it['types']
        if not t or any(b in t for b in BL): continue
        if not any(w in t for w in WL): continue
        if it['qid'] in Q: continue
        base=re.sub(r'\s*\(.*?\)$','',it['title'])
        if norm(base) in N or norm(it['title']) in N: continue
        m=re.match(r'Point\(([-\d.]+) ([-\d.]+)\)',it['coord'])
        lng,lat=float(m.group(1)),float(m.group(2))
        near=min(((dist(lat,lng,p[0],p[1]),p[3]) for p in P),default=(99,''))
        if near[0]<0.5: continue
        it.update(lat=lat,lng=lng,nearest=near[1],nearestKm=round(near[0],2))
        keep.append(it)
    keep.sort(key=lambda x:-x['n'])
    out[pref]=keep
json.dump(out,open('cands_f.json','w'),ensure_ascii=False,indent=0)
for p,k in out.items():
    print(p,len(k),' / '.join(f"{x['title']}({x['n']})" for x in k[:16]))
