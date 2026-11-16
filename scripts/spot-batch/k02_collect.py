import re,time,json,html,sys
from k01_kunishitei_lib import *
CATS=[(401,'史跡名勝天然記念物'),(102,'国宝・重要文化財（建造物）'),(103,'重要伝統的建造物群保存地区'),(411,'登録記念物'),(412,'重要文化的景観')]
PREFS=sys.argv[1].split(',')
try: out=json.load(open('kall.json'))
except: out={}
for pref in PREFS:
    for rid,kind in CATS:
        key=f'{pref}|{rid}'
        if key in out: continue
        h=get(B+f'/bsys/categorylist?register_id={rid}'); t=token(h)
        r=post(B+'/bsys/searchlist',{'_method':'POST','_csrfToken':t,'register_sub_id':str(rid),'seat_pref':pref,'kind_page_check':kind,'pageSize':'100'})
        tot=re.search(r'class="searchnum">\s*([\d,]+)\s*件中',r)
        items=[]
        for row in re.findall(r'<tr[^>]*class="resultback[^"]*"[^>]*>(.*?)</tr>',r,re.S):
            m=re.search(r'href="(/heritage/detail/[^"]+)"',row)
            c=re.search(r"mapChange\(\s*'[^']*',\s*'[^']*',\s*(-?[\d.]+),\s*(-?[\d.]+)",row)
            cells=[re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',x))).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>',row,re.S)]
            items.append({'url':m and m.group(1),'lat':c and float(c.group(1)),'lng':c and float(c.group(2)),'cells':cells})
        out[key]={'total':tot and tot.group(1),'items':items}
        print(key,tot and tot.group(1),len(items),flush=True)
        json.dump(out,open('kall.json','w'),ensure_ascii=False)
        time.sleep(3)
