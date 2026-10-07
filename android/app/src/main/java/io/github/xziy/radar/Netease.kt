package io.github.xziy.radar

import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

class Netease(private val store:Store,context:android.content.Context) {
 val client=OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(25,TimeUnit.SECONDS).callTimeout(40,TimeUnit.SECONDS).build()
 private val xeapi=Xeapi(context,store,client)
 companion object {
  private const val PUBLIC="MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB"
  private fun aes(value:String,key:String):String {val cipher=Cipher.getInstance("AES/CBC/PKCS5Padding");cipher.init(Cipher.ENCRYPT_MODE,SecretKeySpec(key.toByteArray(),"AES"),IvParameterSpec("0102030405060708".toByteArray()));return Base64.getEncoder().encodeToString(cipher.doFinal(value.toByteArray()))}
  fun encrypt(value:String,secret:String?=null):Pair<String,String>{val random=SecureRandom();val alphabet="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";val key=secret?:CharArray(16){alphabet[random.nextInt(alphabet.length)]}.concatToString();val rsa=KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(PUBLIC))) as RSAPublicKey;val encoded=BigInteger(1,key.reversed().toByteArray()).modPow(rsa.publicExponent,rsa.modulus).toString(16).padStart(256,'0');return aes(aes(value,"0CoJUm6Qyw8W8jud"),key) to encoded}
  fun json(vararg fields:Pair<String,Any?>)=JSONObject().apply{fields.forEach{put(it.first,it.second?:JSONObject.NULL)}}
  fun objects(a:JSONArray?)=(0 until (a?.length()?:0)).mapNotNull{a?.optJSONObject(it)}
  fun safePlaybackUrl(raw:String):String {val url=java.net.URI(raw.replaceFirst("http:","https:"));val host=url.host?.lowercase()?:"";require(url.scheme=="https"&&listOf("music.126.net","music.163.com","126.net","163.com").any{host==it||host.endsWith("."+it)}){"网易云返回的播放地址无效"};return url.toASCIIString()}
 }
 suspend fun call(path:String,data:JSONObject=JSONObject(),anonymous:Boolean=false):JSONObject=withContext(Dispatchers.IO) {
  val cookie=if(anonymous)"" else store.cookie()
  val cookies=cookie.split(';').mapNotNull {part->val i=part.indexOf('=');if(i>0)part.substring(0,i).trim() to part.substring(i+1).trim() else null}.toMap().toMutableMap()
  data.put("csrf_token",cookies["__csrf"]?:"");data.put("e_r",false)
  val encrypted=encrypt(data.toString());val body=FormBody.Builder().add("params",encrypted.first).add("encSecKey",encrypted.second).build()
  val request=Request.Builder().url("https://music.163.com/weapi/"+path.removePrefix("/api/")+"?timestamp="+System.currentTimeMillis()).header("Referer","https://music.163.com/").header("User-Agent","Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36").header("Cookie",cookie).post(body).build()
  client.newCall(request).execute().use {response->
   check(response.isSuccessful){"网易云连接失败（HTTP "+response.code+"），请稍后重试"}
   val result=JSONObject(response.body?.string()?:"{}")
   val code=result.optInt("code",200)
   check(code in setOf(200,800,801,802,803)) {when(code){301,302->"登录已失效，请重新连接账号";405,406,415->"网易云要求额外验证，请使用二维码登录或稍后重试";else->"网易云暂未提供该数据（"+code+"）"}}
   val changes=response.headers.values("Set-Cookie")
   if(changes.isNotEmpty()){
    val merged=store.cookie().split(';').mapNotNull{val i=it.indexOf('=');if(i>0)it.substring(0,i).trim() to it.substring(i+1).trim() else null}.toMap().toMutableMap()
    changes.forEach{val part=it.substringBefore(';');val i=part.indexOf('=');if(i>0){val key=part.substring(0,i);val value=part.substring(i+1);if(value.isEmpty())merged.remove(key) else merged[key]=value}}
    store.cookie(merged.entries.joinToString("; "){it.key+"="+it.value})
   }
   result
  }
 }
 suspend fun sendCode(phone:String,country:String){require(phone.matches(Regex("[0-9]{6,15}"))&&country.matches(Regex("[0-9]{1,4}"))){"请填写正确的号码和地区代码"};call("/api/sms/captcha/sent",json("cellphone" to phone,"ctcode" to country,"secrete" to "music_middleuser_pclogin"),true)}
 suspend fun login(phone:String,country:String,code:String):Profile {require(code.matches(Regex("[0-9]{4,8}"))){"请填写短信验证码"};call("/api/w/login/cellphone",json("type" to "1","https" to "true","phone" to phone,"countrycode" to country,"captcha" to code,"remember" to "true","secureCaptcha" to ""),true);return account()}
 suspend fun qr():String=call("/api/login/qrcode/unikey",json("type" to 3),true).optString("unikey").also{check(it.isNotEmpty()){"无法生成二维码"}}
 suspend fun qrCheck(key:String):Int=call("/api/login/qrcode/client/login",json("type" to 3,"key" to key),true).optInt("code")
 suspend fun account():Profile {val p=call("/api/nuser/account/get").optJSONObject("profile");check(p!=null&&p.optLong("userId")>0){"请先登录网易云"};return Profile(p!!.optLong("userId"),p.optString("nickname","网易云用户"))}
 suspend fun playlists(uid:Long):List<Playlist>{val lists=mutableListOf<Playlist>();var offset=0;do{val r=call("/api/user/playlist",json("uid" to uid,"limit" to 100,"offset" to offset));val entries=objects(r.optJSONArray("playlist"));lists+=entries.map{Playlist(it.optLong("id"),it.optString("name"),it.optInt("trackCount"),it.optJSONObject("creator")?.optLong("userId")?:0,strings(it.optJSONArray("tags")),it.optInt("specialType"))};offset+=100;if(!r.optBoolean("more")||entries.isEmpty())break}while(offset<10000);return lists.distinctBy{it.id}}
 suspend fun playlist(id:Long):JSONObject=call("/api/v6/playlist/detail",json("id" to id,"n" to 100000,"s" to 0)).getJSONObject("playlist")
 suspend fun details(ids:List<Long>,tags:List<String> = emptyList()):List<Song>{val songs=mutableListOf<Song>();for(batch in ids.chunked(100)){val r=call("/api/v3/song/detail",json("c" to JSONArray(batch.map{json("id" to it)}).toString()));songs+=objects(r.optJSONArray("songs")).map{song(it,tags)}};return songs}
 suspend fun fullPlaylist(id:Long,old:Map<Long,Song>,progress:(String)->Unit):List<Song>{val p=playlist(id);val ids=objects(p.optJSONArray("trackIds")).map{it.optLong("id")};val tags=strings(p.optJSONArray("tags"));val result=mutableListOf<Song>();for(batch in ids.chunked(100)){progress("读取 "+p.optString("name")+" · "+result.size+" / "+ids.size);result+=details(batch,tags).map{s->old[s.id]?.let{o->s.copy(lyrics=o.lyrics,mood=o.mood,theme=o.theme,language=o.language,audio=o.audio)}?:s}};return result}
 suspend fun lyric(id:Long):String=call("/api/song/lyric",json("id" to id,"tv" to -1,"lv" to -1,"rv" to -1,"kv" to -1)).optJSONObject("lrc")?.optString("lyric")?:""
 suspend fun similar(id:Long):List<Song> =objects(call("/api/v1/discovery/simiSong",json("songid" to id,"limit" to 50,"offset" to 0)).optJSONArray("songs")).map{song(it).copy(seedIds=listOf(id))}
 suspend fun daily():List<Song>{val r=call("/api/v3/discovery/recommend/songs",json("afresh" to true));return objects(r.optJSONObject("data")?.optJSONArray("dailySongs")).map{song(it)}}
 suspend fun discover(tag:String,offset:Int):List<Long> =objects(call("/api/playlist/list",json("cat" to tag,"limit" to 8,"offset" to offset,"order" to "hot","total" to true)).optJSONArray("playlists")).map{it.optLong("id")}
 suspend fun playback(id:Long):Pair<String,Boolean>{val args=json("ids" to "[$id]","level" to "standard","encodeType" to "aac");val r=try{xeapi.call("/api/song/enhance/player/url/v1",args)}catch(e:kotlinx.coroutines.CancellationException){throw e}catch(_:Exception){call("/api/song/enhance/player/url/v1",args)};val item=objects(r.optJSONArray("data")).firstOrNull{it.optLong("id")==id};check(item!=null&&!item.isNull("url")){"这首歌暂时无法播放，请检查账号权限或进入网易云"};return safePlaybackUrl(item!!.getString("url")) to !item.isNull("freeTrialInfo")}
 suspend fun favorite(song:Long,list:Long,add:Boolean,likes:Boolean=false){if(likes)call("/api/radio/like",json("alg" to "itembased","trackId" to song,"like" to add,"time" to "3")) else call("/api/playlist/manipulate/tracks",json("op" to if(add)"add" else "del","pid" to list,"trackIds" to "[$song]","imme" to "true"));val ids=objects(playlist(list).optJSONArray("trackIds")).map{it.optLong("id")};check((song in ids)==add){"网易云尚未确认收藏变化，请稍后重试"}}
 private fun strings(a:JSONArray?)=(0 until (a?.length()?:0)).map{a!!.optString(it)}.filter{it.isNotBlank()}
 private fun song(s:JSONObject,tags:List<String> = emptyList()):Song {val ar=s.optJSONArray("ar")?:s.optJSONArray("artists");val al=s.optJSONObject("al")?:s.optJSONObject("album");val timestamp=s.optLong("publishTime");return Song(id=s.optLong("id"),name=s.optString("name"),artists=objects(ar).map{Artist(it.optLong("id"),it.optString("name"))},album=al?.optString("name")?:"",albumId=al?.optLong("id")?:0,cover=(al?.optString("picUrl")?:"").replaceFirst("http:","https:"),duration=s.optLong("dt",s.optLong("duration")),year=if(timestamp>0)Instant.ofEpochMilli(timestamp).atZone(ZoneId.of("Asia/Shanghai")).year else null,tags=tags,unavailable=s.has("noCopyrightRcmd")&&!s.isNull("noCopyrightRcmd"))}
}
