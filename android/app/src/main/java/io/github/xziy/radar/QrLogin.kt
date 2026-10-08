package io.github.xziy.radar

import kotlinx.coroutines.delay

suspend fun awaitQrConfirmation(check:suspend()->Int,status:(Int)->Unit,wait:suspend()->Unit={delay(2000)}){
 while(true){val code=check();status(code);when(code){803->return;800->error("二维码已过期，请重新生成");801,802->wait();else->error("扫码状态异常，请重新生成二维码")}}
}

// Response cookie strings can be full Set-Cookie headers or a plain Cookie
// list. Attributes never become request cookies; a QR success must supply a
// fresh MUSIC_U instead of accidentally reusing an earlier account session.
object LoginCookies {
 private val attributes=setOf("path","domain","expires","max-age","secure","httponly","samesite","priority","partitioned")
 fun merge(previous:String,changes:List<String>,replace:Boolean=false):String{
  val values=linkedMapOf<String,String>()
  fun add(raw:String){raw.split(';').forEach{part->val split=part.indexOf('=');if(split>0){val name=part.substring(0,split).trim();val value=part.substring(split+1).trim();if(name.lowercase() !in attributes){if(value.isEmpty())values.remove(name) else values[name]=value}}}}
  if(!replace)add(previous)
  changes.forEach(::add)
  if(replace)check(!values["MUSIC_U"].isNullOrBlank()){"网易云已确认扫码，但未返回登录凭据，请重新生成二维码"}
  return values.entries.joinToString("; "){it.key+"="+it.value}
 }
}
