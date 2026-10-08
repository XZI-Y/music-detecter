"""Publish only the reviewed Android source and signed APK to the fixed owner repo."""
from pathlib import Path
import subprocess,json,urllib.request,urllib.error,base64,hashlib,zipfile,time,os,concurrent.futures
project=Path(__file__).resolve().parents[1]
workspace=project.parents[1]
repo='XZI-Y/music-detecter'
gh=project.parent/'tools/github-cli/bin/gh.exe'
env={**os.environ,'GH_CONFIG_DIR':str(project.parent/'github-connection'),'GODEBUG':'http2client=0'}
import sys
def report_failure(kind,error,tb):
 result={'status':'failed','message':str(error)[:240]}
 (workspace/'work/radar-android-release-result.json').write_text(json.dumps(result),encoding='utf-8')
 print('Android publishing failed:',result['message'],flush=True)
sys.excepthook=report_failure
def api(path,method='GET',data=None):
 args=[str(gh),'api',path,'--method',method]
 raw=None
 if data is not None:args+=['--input','-'];raw=json.dumps(data,ensure_ascii=False).encode()
 for attempt in range(5):
  result=subprocess.run(args,input=raw,capture_output=True,env=env)
  if not result.returncode:return json.loads(result.stdout) if result.stdout.strip() else None
  message=result.stderr.decode('utf-8',errors='replace')[:400]
  if not any(term in message.lower() for term in ['eof','timeout','connection','handshake']):raise RuntimeError('GitHub CLI: '+message)
  if attempt<4:time.sleep(2**attempt)
 raise RuntimeError('GitHub CLI: '+message)
apk=workspace/'outputs/Radar-Android-1.0.2.apk'
manifest=json.loads((project/'update.json').read_text())
assert manifest['versionCode']==3 and manifest['versionName']=='1.0.2'
assert hashlib.sha256(apk.read_bytes()).hexdigest()==manifest['sha256']
checks=project/'app/build/test-results/testDebugUnitTest'
reports=list(checks.glob('TEST-*.xml'))
assert reports and all('failures="0"' in file.read_text() and 'errors="0"' in file.read_text() for file in reports)
allowed={'.kt','.kts','.xml','.properties','.md','.pro','.png','.txt','.json','.cjs','.py'}
files=[]
for file in sorted(project.rglob('*')):
 if not file.is_file():continue
 rel=file.relative_to(project)
 if any(part in {'build','.gradle','.git','.github','__pycache__'} for part in rel.parts):continue
 if file.name=='.gitignore' or file.suffix.lower() in allowed or str(rel).replace('\\','/')=='gradle/wrapper/gradle-wrapper.jar' or file.name in {'gradlew','gradlew.bat'}:files.append(file)
assert not any(file.suffix.lower() in {'.jks','.keystore','.key','.pem'} for file in files)
user=api('user');author={'name':user['login'],'email':str(user['id'])+'+'+user['login']+'@users.noreply.github.com'}
remote=api('repos/'+repo)
assert remote['full_name'].lower()==repo.lower() and remote.get('permissions',{}).get('push')
branch=remote['default_branch'];ref=api('repos/'+repo+'/git/ref/heads/'+branch);parent=ref['object']['sha'];commit=api('repos/'+repo+'/git/commits/'+parent)
def blob(file):
 raw=file.read_bytes()
 value=api('repos/'+repo+'/git/blobs','POST',{'content':base64.b64encode(raw).decode(),'encoding':'base64'})
 return {'path':'android/'+file.relative_to(project).as_posix(),'mode':'100644','type':'blob','sha':value['sha']}
print('Uploading Android source',flush=True)
with concurrent.futures.ThreadPoolExecutor(3) as pool:entries=list(pool.map(blob,files))
workflow=(project/'.github/android-build.yml').read_bytes()
sha=api('repos/'+repo+'/git/blobs','POST',{'content':base64.b64encode(workflow).decode(),'encoding':'base64'})['sha']
entries.append({'path':'.github/workflows/android.yml','mode':'100644','type':'blob','sha':sha})
tree=api('repos/'+repo+'/git/trees','POST',{'base_tree':commit['tree']['sha'],'tree':entries})
new=api('repos/'+repo+'/git/commits','POST',{'message':'Fix Android audio analysis recovery and music DNS fallback','tree':tree['sha'],'parents':[parent],'author':author,'committer':author})
api('repos/'+repo+'/git/refs/heads/'+branch,'PATCH',{'sha':new['sha'],'force':False})
tag='android-v1.0.2'
try:
 release=api('repos/'+repo+'/releases/tags/'+tag)
except RuntimeError as e:
 if 'HTTP 404' not in str(e):raise
 release=api('repos/'+repo+'/releases','POST',{'tag_name':tag,'target_commitish':new['sha'],'name':'雷达 Android 1.0.2 · A17 实机测试版','body':'修正音频分析失败后当天无法重试；音频通过统一 HTTPS/DNS 客户端获取并在本地解码，分析多个片段。新增音频分析结果与失败原因统计，以及网易云域名解析失败时的可关闭 HTTPS DNS 备用解析。保留原模型缓存、账号和音乐资料，使用原签名覆盖安装。真实 A17 音频与网络效果仍需实机确认。','draft':True,'prerelease':True,'make_latest':'false'})

source=workspace/'outputs/Radar-Android-Source-1.0.2.zip'
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as z:
 for file in files:z.write(file,'android/'+file.relative_to(project).as_posix())
 z.writestr('.github/workflows/android.yml',workflow)
for asset in [apk,source,workspace/'outputs/Radar-Android-1.0.2.sha256']:
 digest=hashlib.sha256(asset.read_bytes()).hexdigest();existing=next((item for item in release.get('assets',[]) if item['name']==asset.name),None)
 if existing:
  if existing.get('digest')=='sha256:'+digest:continue
  raise RuntimeError('An asset with this name already exists; preserve it and use a new version')
 print('Uploading',asset.name,flush=True)
 result=subprocess.run([str(gh),'release','upload',tag,str(asset),'--repo',repo],capture_output=True,env=env)
 if result.returncode:raise RuntimeError('Asset upload failed: '+result.stderr.decode('utf-8',errors='replace')[:400])
release=api('repos/'+repo+'/releases/'+str(release['id']),'PATCH',{'draft':False,'prerelease':True,'make_latest':'false'})
result={'status':'published','url':release['html_url'],'commit':new['sha'],'tag':tag,'sha256':manifest['sha256']}
(workspace/'work/radar-android-release-result.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False),flush=True)
