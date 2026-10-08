package io.github.xziy.radar

import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.UnknownHostException
import java.net.SocketTimeoutException
import java.util.Base64
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLException

object NetworkProblems {
 fun dns(error:Throwable):Boolean=generateSequence(error){it.cause?.takeIf{c->c!==it}}.take(12).any{it is UnknownHostException}
 fun message(error:Throwable):String=when {
  error is UpdateConnectionException->error.message.orEmpty()
  dns(error)->"网易云域名解析失败，请检查网络、代理或系统私有 DNS；已有分析结果已保留"
  generateSequence(error){it.cause?.takeIf{c->c!==it}}.take(12).any{it is SocketTimeoutException}->"网易云连接超时，请稍后重试；已有分析结果已保留"
  error is SSLException->"安全连接未建立，请检查网络及手机日期时间"
  else->error.message?.take(180)?:"操作暂未完成，请重试"
 }
}
object DnsWire {
 fun query(host:String):ByteArray {require(host.length<=253&&host.split('.').all{it.length in 1..63&&it.all{c->c.isLetterOrDigit()||c=='-'}});val out=ByteArrayOutputStream();out.write(byteArrayOf(0,0,1,0,0,1,0,0,0,0,0,0));for(label in host.split('.')){out.write(label.length);out.write(label.toByteArray(Charsets.US_ASCII))};out.write(byteArrayOf(0,0,1,0,1));return out.toByteArray()}
 fun addresses(bytes:ByteArray):List<ByteArray> {
  require(bytes.size in 12..65535)
  fun u16(p:Int):Int{require(p+2<=bytes.size);return ((bytes[p].toInt() and 255) shl 8) or (bytes[p+1].toInt() and 255)}
  require(u16(0)==0&&(u16(2) and 0x800f)==0x8000&&(u16(2) and 0x0200)==0)
  fun skipName(start:Int):Int {var p=start;repeat(128){require(p<bytes.size);val n=bytes[p].toInt() and 255;if(n==0)return p+1;if(n and 0xc0==0xc0){require(p+1<bytes.size);return p+2};require(n<=63&&p+1+n<=bytes.size);p+=1+n};error("Invalid DNS name")}
  var p=12;repeat(u16(4)){p=skipName(p);require(p+4<=bytes.size);p+=4};val values=mutableListOf<ByteArray>()
  repeat(u16(6)){p=skipName(p);require(p+10<=bytes.size);val type=u16(p);val clazz=u16(p+2);val length=u16(p+8);p+=10;require(p+length<=bytes.size);if(clazz==1&&((type==1&&length==4)||(type==28&&length==16)))values+=bytes.copyOfRange(p,p+length);p+=length}
  return values
 }
 fun eligible(host:String)=listOf("music.163.com","music.126.net").any{host==it||host.endsWith("."+it)}
}
class MusicDns(private val enabled:()->Boolean):Dns {
 private val cache=java.util.concurrent.ConcurrentHashMap<String,Pair<Long,List<InetAddress>>>()
 private val bootstrap=OkHttpClient.Builder().dns(object:Dns{override fun lookup(host:String):List<InetAddress> = if(host=="dns.alidns.com")listOf(InetAddress.getByAddress(byteArrayOf(223.toByte(),5,5,5)),InetAddress.getByAddress(byteArrayOf(223.toByte(),6,6,6))) else Dns.SYSTEM.lookup(host)}).connectTimeout(4,TimeUnit.SECONDS).readTimeout(4,TimeUnit.SECONDS).callTimeout(7,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
 override fun lookup(hostname:String):List<InetAddress> {
  try{return Dns.SYSTEM.lookup(hostname).also{if(it.isEmpty())throw UnknownHostException(hostname)}}catch(original:UnknownHostException){
   if(!enabled()||!DnsWire.eligible(hostname))throw original
   cache[hostname]?.let{if(it.first>System.currentTimeMillis())return it.second}
   try{val query=Base64.getUrlEncoder().withoutPadding().encodeToString(DnsWire.query(hostname));val r=Request.Builder().url("https://dns.alidns.com/dns-query?dns="+query).header("Accept","application/dns-message").build()
    bootstrap.newCall(r).execute().use{response->check(response.isSuccessful);val body=response.body?:error("No DNS response");check(body.contentLength()<=65535);val bytes=body.byteStream().use{input->val out=ByteArrayOutputStream();val buffer=ByteArray(4096);while(true){val n=input.read(buffer);if(n<0)break;check(out.size()+n<=65535);out.write(buffer,0,n)};out.toByteArray()};val found=DnsWire.addresses(bytes).map{InetAddress.getByAddress(hostname,it)};check(found.isNotEmpty());cache[hostname]=System.currentTimeMillis()+60_000L to found;return found}
   }catch(_:Exception){throw original}
  }
 }
}
