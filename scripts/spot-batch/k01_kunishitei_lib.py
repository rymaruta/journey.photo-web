import re,html,time,urllib.request,urllib.parse,http.cookiejar,ssl,json,sys
CTX=ssl.create_default_context()
cj=http.cookiejar.CookieJar()
op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj),urllib.request.HTTPSHandler(context=CTX))
UA={'User-Agent':'Mozilla/5.0 (compatible; JourneyPhotoSpotCheck/1.0; +https://journey-photo.com)'}
B='https://kunishitei.bunka.go.jp'
def get(u):
    r=op.open(urllib.request.Request(u,headers=UA),timeout=40); return r.read().decode('utf-8','replace')
def post(u,data):
    d=urllib.parse.urlencode(data).encode()
    r=op.open(urllib.request.Request(u,data=d,headers=UA),timeout=60); return r.read().decode('utf-8','replace')
def token(h): return re.search(r'name="_csrfToken"[^>]*value="([0-9a-f]+)"',h).group(1)
if __name__=='__main__':
    h=get(B+'/bsys/categorylist?register_id='+sys.argv[1])
    t=token(h)
    out=post(B+'/bsys/searchlist',{'_method':'POST','_csrfToken':t,'register_sub_id':sys.argv[1],'seat_pref':sys.argv[2],'kind_page_check':sys.argv[3] if len(sys.argv)>3 else ''})
    open('res.html','w').write(out)
    print(len(out)); print(re.sub(r'\s+',' ',re.sub(r'<script.*?</script>|<style.*?</style>','',re.sub(r'<[^>]+>',' ',out),flags=re.S))[:1200])
