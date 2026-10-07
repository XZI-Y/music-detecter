package io.github.xziy.radar

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

data class UpdateRelease(val code:Int,val name:String,val url:String,val sha:String)
class Updates(private val context:Context,private val api:Netease){
 suspend fun check():UpdateRelease?=withContext(Dispatchers.IO){
  val request=Request.Builder().url("https://raw.githubusercontent.com/XZI-Y/music-detecter/main/android/update.json").header("Cache-Control","no-cache").build()
  api.client.newCall(request).execute().use{r->if(r.code==404)return@withContext null;check(r.isSuccessful){"无法检查更新，请稍后重试"};val j=JSONObject(r.body!!.string());val code=j.getInt("versionCode");val installed=context.packageManager.getPackageInfo(context.packageName,0);val installedCode=if(Build.VERSION.SDK_INT>=28)installed.longVersionCode else installed.versionCode.toLong();if(code.toLong()<=installedCode)return@withContext null;val url=j.getString("url");val uri=Uri.parse(url);check(uri.scheme=="https"&&uri.host=="github.com"&&uri.path?.startsWith("/XZI-Y/music-detecter/releases/download/android-")==true){"更新地址无效"};val sha=j.getString("sha256").lowercase();check(sha.matches(Regex("[0-9a-f]{64}"))){"更新校验信息无效"};UpdateRelease(code,j.getString("versionName"),url,sha)}
 }
 suspend fun download(release:UpdateRelease,progress:(String)->Unit):File=withContext(Dispatchers.IO){
  val dir=File(context.cacheDir,"updates").apply{mkdirs()};val file=File(dir,"radar-"+release.code+".apk");val part=File(dir,file.name+".part")
  api.client.newBuilder().callTimeout(20,java.util.concurrent.TimeUnit.MINUTES).build().newCall(Request.Builder().url(release.url).build()).execute().use{r->check(r.isSuccessful){"更新下载失败"};val total=r.body?.contentLength()?:-1;check(total<=150*1024*1024){"更新文件过大"};r.body!!.byteStream().use{input->part.outputStream().use{out->val buffer=ByteArray(65536);var count=0L;var last=0L;while(true){currentCoroutineContext().ensureActive();val n=input.read(buffer);if(n<0)break;count+=n;check(count<=150*1024*1024){"更新文件过大"};out.write(buffer,0,n);if(System.currentTimeMillis()-last>500){last=System.currentTimeMillis();progress("下载更新 · "+if(total>0)(count*100/total).toString()+"%" else (count/1024).toString()+" KB")}}}}}
  val hash=MessageDigest.getInstance("SHA-256");part.inputStream().use{input->val buffer=ByteArray(65536);while(true){val n=input.read(buffer);if(n<0)break;hash.update(buffer,0,n)}};check(hash.digest().joinToString(""){"%02x".format(it)}==release.sha){"更新校验失败，请重新下载"}
  val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
  val archived=context.packageManager.getPackageArchiveInfo(part.absolutePath,flags)?:error("安装包无法识别");val current=context.packageManager.getPackageInfo(context.packageName,flags)
  check((if(Build.VERSION.SDK_INT>=28)archived.longVersionCode else archived.versionCode.toLong())==release.code.toLong()){"安装包版本不符"};check(archived.packageName==context.packageName){"安装包身份不符"};val signatures=if(Build.VERSION.SDK_INT>=28)archived.signingInfo?.apkContentsSigners else archived.signatures;val existing=if(Build.VERSION.SDK_INT>=28)current.signingInfo?.apkContentsSigners else current.signatures
  check(signatures!=null&&existing!=null&&signatures.map{it.toCharsString()}.toSet()==existing.map{it.toCharsString()}.toSet()){"安装包签名不符，已取消更新"}
  check(part.renameTo(file)){"无法保存更新文件"};file
 }
 fun install(file:File):Boolean {
  if(!context.packageManager.canRequestPackageInstalls()){context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return false}
  val uri=FileProvider.getUriForFile(context,context.packageName+".files",file);context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK));return true
 }
}
