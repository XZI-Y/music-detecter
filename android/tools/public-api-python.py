from pathlib import Path
import subprocess,json,urllib.request,urllib.parse,time
root=Path(__file__).resolve().parents[1]
script=(root/'tools/check-public-api.cjs').read_text().split("console.log('crypto fixture'")[0]
cases=[('v3/song/detail',{'c':'[{"id":347230}]'}),('song/lyric',{'id':347230,'lv':-1,'tv':-1}),('song/enhance/player/url/v1',{'ids':'[347230]','level':'standard','encodeType':'aac'})]
results=[]
for endpoint,payload in cases:
 payload.update(e_r=False,csrf_token='')
 command=script+"\nconsole.log(JSON.stringify(encrypt("+json.dumps(payload,ensure_ascii=False)+")));"
 wire=json.loads(subprocess.check_output(['node','-e',command],cwd=root))
 for attempt in range(3):
  try:
   req=urllib.request.Request('https://music.163.com/weapi/'+endpoint,data=urllib.parse.urlencode(wire).encode(),headers={'Referer':'https://music.163.com/','User-Agent':'Mozilla/5.0','Content-Type':'application/x-www-form-urlencoded'})
   with urllib.request.urlopen(req,timeout=25) as response:
    data=json.loads(response.read());entry={'endpoint':endpoint,'http':response.status,'code':data.get('code'),'songCount':len(data.get('songs',[])),'hasLyrics':bool(data.get('lrc',{}).get('lyric')),'hasPlayback':bool((data.get('data') or [{}])[0].get('url'))}
   results.append(entry);print(entry,flush=True);break
  except Exception as e:
   if attempt==2:results.append({'endpoint':endpoint,'error':type(e).__name__});print('Failed',endpoint,type(e).__name__,flush=True)
(root/'verification').mkdir(exist_ok=True)
(root/'verification/public-api-python.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
