from pathlib import Path
import json,subprocess,secrets,hashlib,shutil
project=Path(__file__).resolve().parents[1]
workspace=project.parents[1]
tools=project.parent/'android-tools'
paths=json.loads((tools/'paths.json').read_text())
private=project.parent/'android-signing';private.mkdir(exist_ok=True)
key=private/'radar-release.jks';password=private/'store-password.txt'
if key.exists() and not password.exists():raise RuntimeError('Existing signing key needs its original password file')
if not password.exists():password.write_text(secrets.token_urlsafe(40),encoding='utf-8')
if not key.exists():
 command=[str(Path(paths['java'])/'bin/keytool.exe'),'-genkeypair','-keystore',str(key),'-alias','radar-release','-storepass:file',str(password),'-keypass:file',str(password),'-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=Radar Android, O=XZI-Y']
 result=subprocess.run(command,capture_output=True)
 if result.returncode:raise RuntimeError('Unable to create persistent signing key')
unsigned=project/'app/build/outputs/apk/release/app-release-unsigned.apk'
if not unsigned.exists():raise RuntimeError('Build the release APK first')
output=workspace/'outputs'/'Radar-Android-1.0.2.apk'
signer=Path(paths['sdk'])/'build-tools/35.0.0/apksigner.bat'
command=[str(signer),'sign','--ks',str(key),'--ks-key-alias','radar-release','--ks-pass','file:'+str(password),'--out',str(output),str(unsigned)]
environment=__import__('os').environ.copy();environment['JAVA_HOME']=paths['java']
result=subprocess.run(command,capture_output=True,env=environment)
if result.returncode:
 (private/'sign-error.txt').write_bytes(result.stderr+result.stdout)
 raise RuntimeError('Unable to sign APK')
result=subprocess.run([str(signer),'verify','--verbose','--print-certs',str(output)],capture_output=True,env=environment)
if result.returncode:raise RuntimeError('APK signature verification failed')
(project/'verification/signature.txt').write_bytes(result.stdout)
print(result.stdout.decode(errors='replace'))
sha=hashlib.sha256(output.read_bytes()).hexdigest()
manifest={'versionCode':3,'versionName':'1.0.2','url':'https://github.com/XZI-Y/music-detecter/releases/download/android-v1.0.2/Radar-Android-1.0.2.apk','sha256':sha}
(project/'update.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
(workspace/'outputs'/'Radar-Android-1.0.2.sha256').write_text(sha+'  '+output.name+'\n',encoding='utf-8')
print(json.dumps({'apk':str(output),'bytes':output.stat().st_size,'sha256':sha}))
