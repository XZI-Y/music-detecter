package io.github.xziy.radar

import android.content.Context
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.json.JSONObject
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.UUID
import java.util.zip.GZIPInputStream
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.crypto.spec.GCMParameterSpec

class Xeapi(context:Context,private val store:Store,private val client:OkHttpClient) {
 private val prefs=context.getSharedPreferences("protocol",0)
 private val device=prefs.getString("device",null)?:UUID.randomUUID().toString().also{prefs.edit().putString("device",it).apply()}
 private val random=SecureRandom();private var publicKey:JSONObject?=null
 companion object{
  private val staticKey="ab1d5a430f6bb04a3f01e81ddd72bd916d5ce591248ac128714806d7f8fb1b84".chunked(2).map{it.toInt(16).toByte()}.toByteArray()
  private const val signKey="mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g=="
  private fun hmac(key:ByteArray,text:ByteArray)=Mac.getInstance("HmacSHA256").run{init(SecretKeySpec(key,"HmacSHA256"));doFinal(text)}
  private fun signature(timestamp:String,nonce:String)=Base64.getEncoder().encodeToString(hmac(signKey.toByteArray(),(timestamp+nonce).toByteArray()))
  private fun aes(key:ByteArray,bytes:ByteArray,decrypt:Boolean=false)=Cipher.getInstance("AES/ECB/PKCS5Padding").run{init(if(decrypt)Cipher.DECRYPT_MODE else Cipher.ENCRYPT_MODE,SecretKeySpec(key,"AES"));doFinal(bytes)}
  private fun base(bytes:ByteArray)=Base64.getEncoder().encodeToString(bytes)
 }
 @Synchronized private fun key():JSONObject {
  publicKey?.let{return it};val nonce=CharArray(16){('0'.code+random.nextInt(10)).toChar()}.concatToString();val time=System.currentTimeMillis().toString()
  val body=FormBody.Builder().add("appVersion","9.5.61").add("currentKeyVersion","").add("deviceId",device).add("nonce",nonce).add("os","android").add("requestType","active").add("signature",signature(time,nonce)).add("t1","").add("t2","").add("timestamp",time).add("uid","").build()
  val request=Request.Builder().url("https://interface.music.163.com/api/gorilla/anti/crawler/security/key/get").header("User-Agent","NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 15)").header("Cookie","deviceId="+device).post(body).build()
  client.newCall(request).execute().use{r->check(r.isSuccessful){"播放协议连接失败"};val value=JSONObject(r.body!!.string());check(value.optInt("code")==200){"播放协议暂未就绪"};val data=value.getJSONObject("data");val expected=signature(data.get("timestamp").toString(),nonce);check(MessageDigest.isEqual(expected.toByteArray(),data.getString("signature").toByteArray())){"播放协议校验失败"};val decoded=JSONObject(String(aes(staticKey,Base64.getDecoder().decode(data.getString("encryptedData")),true)));check(decoded.optString("sk").isNotBlank()&&decoded.optString("publicKey").isNotBlank()){"播放协议缺少密钥"};publicKey=decoded;return decoded}
 }
 suspend fun call(path:String,data:JSONObject):JSONObject=withContext(Dispatchers.IO){
  val key=key();val dynamic=ByteArray(16).also{random.nextBytes(it)}
  val form=data.keys().asSequence().filter{it!="e_r"}.joinToString("&"){URLEncoder.encode(it,"UTF-8")+"="+URLEncoder.encode(data.get(it).toString(),"UTF-8")}
  val plaintext=JSONObject().put("body",base(form.toByteArray())).put("queryString","e_r=true").toString().toByteArray()
  val inner=aes(staticKey,plaintext);val mask=ByteArray(16).also{random.nextBytes(it)};val xored=ByteArray(inner.size){i->(inner[i].toInt() xor mask[i and 15].toInt()).toByte()};val b64=base(xored).toByteArray();val rotate=(mask[0].toInt() and 15)%b64.size;val mid=mask+b64.copyOfRange(rotate,b64.size)+b64.copyOfRange(0,rotate)
  val b=aes(dynamic,mid)
  val privateKey=X25519PrivateKeyParameters(random);val ephemeral=privateKey.generatePublicKey().encoded;val shared=ByteArray(32);privateKey.generateSecret(X25519PublicKeyParameters(Base64.getDecoder().decode(key.getString("publicKey")),0),shared,0)
  val derived=hmac(hmac(ByteArray(32),shared),ephemeral+byteArrayOf(1)).copyOfRange(0,16);val iv=ByteArray(12).also{random.nextBytes(it)}
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,SecretKeySpec(derived,"AES"),GCMParameterSpec(128,iv));val s=ephemeral+iv+cipher.doFinal((base(dynamic)+"|android|"+key.getString("sk")).toByteArray())
  val r=aes(staticKey,(key.getString("version")+"|").toByteArray());val body=FormBody.Builder().add("B",base(b)).add("S",base(s)).add("R",base(r)).build()
  val cookie=store.cookie()
  val request=Request.Builder().url("https://interface.music.163.com/xeapi/"+path.removePrefix("/api/")).header("User-Agent","NeteaseMusic/9.1.65 (Linux; Android "+Build.VERSION.RELEASE+")").header("X-Client-Enc-State","ENCRYPTED").header("x-aeapi","true").header("x-deviceid",device).header("x-sdeviceid",device).header("x-os","android").header("x-osver",Build.VERSION.RELEASE).header("x-appver","9.1.65").header("x-buildver",(System.currentTimeMillis()/1000).toString()).header("Cookie",cookie+"; os=android; appver=9.1.65; deviceId="+device).apply{cookie.split(';').find{it.trim().startsWith("MUSIC_U=")}?.trim()?.substringAfter('=')?.let{header("x-music-u",it)}}.post(body).build()
  client.newCall(request).execute().use{response->check(response.isSuccessful){"网易云播放连接失败"};val raw=response.body!!.bytes();val decrypted=if(raw.firstOrNull()?.toInt()==123)raw else aes("e82ckenh8dichen8".toByteArray(),raw,true);val bytes=if(decrypted.size>2&&decrypted[0]==0x1f.toByte()&&decrypted[1]==0x8b.toByte())GZIPInputStream(decrypted.inputStream()).use{it.readBytes()} else decrypted;JSONObject(String(bytes))}
 }
}
