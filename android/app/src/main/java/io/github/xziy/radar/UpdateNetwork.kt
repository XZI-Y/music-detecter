package io.github.xziy.radar

import java.io.IOException

class UpdateConnectionException(cause:Throwable):IOException("无法连接 GitHub 更新服务，请切换网络后重试，或通过浏览器下载安装包；当前版本仍可使用",cause)
object UpdateNetwork {
 val addresses=listOf("https://raw.githubusercontent.com/XZI-Y/music-detecter/main/android/update.json","https://api.github.com/repos/XZI-Y/music-detecter/contents/android/update.json?ref=main")
 fun fetch(read:(String)->String):String {
  var last:IOException?=null
  for(address in addresses)try{return read(address)}catch(e:IOException){last=e}
  throw UpdateConnectionException(last!!)
 }
}
