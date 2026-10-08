package io.github.xziy.radar

import java.time.LocalDate
import kotlin.math.*

object Engine {
 val defaults=linkedMapOf("relation" to .18,"style" to .13,"mood" to .05,"theme" to .05,"language" to .03,"era" to .02,"duration" to .02,"feedback" to .08,"instruments" to .20,"rhythm" to .08,"timbre" to .06,"harmony" to .04,"dynamics" to .03,"vocal" to .03)
 fun weights(s:Settings):Map<String,Double>{val w=defaults.mapValues{(k,v)->s.weights[k]?.coerceIn(0.0,1.0)?:v};val total=w.values.sum();return if(total>0)w.mapValues{it.value/total} else defaults}
 private fun overlap(a:List<String>,b:List<String>):Double?=if(a.isEmpty()||b.isEmpty())null else a.count{it in b}.toDouble()/min(a.size,b.size)
 fun identity(s:Song):String=s.name.lowercase().replace(Regex("[（(].*?[)）]"),"").replace(Regex("\\s+"),"")+"|"+s.artists.map{if(it.id>0)it.id.toString() else it.name}.sorted().joinToString(",")
 fun hash(value:String):Long{var h=2166136261L;for(c in value){h=((h xor c.code.toLong())*16777619L) and 0xffffffffL};return h}
 private fun cosine(a:List<Double>,b:List<Double>):Double?{if(a.isEmpty()||a.size!=b.size)return null;val aa=sqrt(a.sumOf{it*it});val bb=sqrt(b.sumOf{it*it});return if(aa*bb>0)a.zip(b).sumOf{it.first*it.second}/aa/bb else null}
 fun rank(song:Song,seeds:List<Song>,data:Data,checkpoint:()->Unit={}):Song {
  val w=weights(data.settings);var best=0.0;var reasons=listOf("探索不同的声音，当前可解释的信息较少")
  for((seedIndex,seed) in seeds.withIndex()){if(seedIndex%64==0)checkpoint();
   val a=song.audio;val b=seed.audio
   val parts=linkedMapOf<String,Double?>("relation" to if(seed.id in song.seedIds)1.0 else null,"style" to overlap(song.tags,seed.tags),"mood" to overlap(song.mood,seed.mood),"theme" to overlap(song.theme,seed.theme),"language" to if(song.language!=null&&seed.language!=null)if(song.language==seed.language)1.0 else 0.0 else null,"era" to if(song.year!=null&&seed.year!=null)max(0.0,1-abs(song.year-seed.year)/20.0) else null,"duration" to if(song.duration>0&&seed.duration>0)max(0.0,1-abs(song.duration-seed.duration)/180000.0) else null,"feedback" to if(data.feedback[seed.id]=="like")1.0 else .3)
   parts["instruments"]=if(a!=null&&b!=null&&a.instruments.isNotEmpty()&&b.instruments.isNotEmpty())overlap(a.instruments.map{it.name},b.instruments.map{it.name}) else null
   parts["rhythm"]=if(a?.bpm!=null&&b?.bpm!=null)max(0.0,1-abs(a.bpm-b.bpm)/70) else null
   parts["timbre"]=if((a?.brightness?:0.0)>0&&(b?.brightness?:0.0)>0)exp(-abs(ln(a!!.brightness!!/b!!.brightness!!))) else null
   parts["harmony"]=if(a!=null&&b!=null)cosine(a.chroma,b.chroma) else null
   parts["dynamics"]=if(a?.dynamics!=null&&b?.dynamics!=null)max(0.0,1-abs(a.dynamics-b.dynamics)) else null
   parts["vocal"]=if(a?.vocal!=null&&b?.vocal!=null)max(0.0,1-abs(a.vocal-b.vocal)) else null
   val evidence=parts.filterValues{it!=null}.keys.sumOf{w[it]?:0.0};val total=parts.entries.sumOf{(w[it.key]?:0.0)*(it.value?:0.0)}
   val score=if(evidence>0)total/evidence*(.45+.55*min(1.0,evidence/.80)) else 0.0
   if(score>best){best=score;val rs=mutableListOf<String>();val instruments=a?.instruments?.map{it.name}?.filter{n->b?.instruments?.any{it.name==n}==true}.orEmpty();if(instruments.isNotEmpty())rs+="音频识别包含相近的 "+instruments.take(3).joinToString("、")+" 音色";if(seed.id in song.seedIds)rs+="与《"+seed.name+"》有歌曲关联";val shared=song.tags.intersect(seed.tags.toSet());if(shared.isNotEmpty())rs+="相关歌单标签接近："+shared.take(3).joinToString("、");if((parts["rhythm"]?:0.0)>.8)rs+="节奏速度接近";if(parts["language"]==1.0)rs+="歌词语言相近";reasons=rs.take(3).ifEmpty{listOf("时长与其他已知音乐特征相近")}}
  }
  return song.copy(score=if(data.feedback[song.id]=="dislike")-1.0 else best,reasons=reasons)
 }
 fun recommend(candidates:List<Song>,data:Data,date:String=day(),checkpoint:()->Unit={}):List<Song>{
  val seeds=data.library.filter{data.feedback[it.id]!="dislike"};val known=seeds.map{it.id}.toSet();val artists=seeds.flatMap{it.artists}.map{it.id}.filter{it>0}.toSet();val cutoff=LocalDate.parse(date).minusDays(data.settings.repeatDays.toLong()).toString()
  val recent=data.history.filter{it.date>=cutoff};val exposed=recent.flatMap{it.ids}.toSet();val used=recent.flatMap{it.identities}.toMutableSet()
  val pool=candidates.distinctBy{it.id}.filter{!it.unavailable&&it.id !in known&&it.id !in exposed&&data.feedback[it.id]!="dislike"&&(!data.settings.avoidKnownArtists||it.artists.none{a->a.id>0&&a.id in artists})}.map{checkpoint();rank(it,seeds,data,checkpoint)}.toMutableList()
  val picked=mutableListOf<Song>();val artistCounts=mutableMapOf<Long,Int>();val albumCounts=mutableMapOf<Long,Int>();val quota=floor(data.settings.count*(100-data.settings.avoidStrength)/100.0).toInt()
  while(picked.size<data.settings.count&&pool.isNotEmpty()){checkpoint();
   val explore=floor((picked.size+1)*data.settings.exploration/100.0)>floor(picked.size*data.settings.exploration/100.0)
   val available=pool.filter {s->identity(s) !in used&&s.artists.none{it.id>0&&(artistCounts[it.id]?:0)>=data.settings.artistLimit}&&(s.albumId==0L||(albumCounts[s.albumId]?:0)<data.settings.albumLimit)&&(!avoided(s,data.settings)||picked.count{avoided(it,data.settings)}<quota)}
   val choice=available.maxByOrNull{s->val novelty=hash(date+":"+data.generations+":"+s.id)/4294967295.0;val shared=picked.maxOfOrNull{overlap(it.tags,s.tags)?:0.0}?:0.0;s.score-(if(avoided(s,data.settings))data.settings.avoidStrength/100.0*.8 else 0.0)-shared*.06+novelty*(if(explore).3 else .015)}?:break
   pool.remove(choice);picked+=choice;used+=identity(choice);choice.artists.filter{it.id>0}.forEach{artistCounts[it.id]=(artistCounts[it.id]?:0)+1};if(choice.albumId>0)albumCounts[choice.albumId]=(albumCounts[choice.albumId]?:0)+1
  }
  return picked
 }
 fun types(s:Song,key:String):List<String> =when(key){
  "style"->s.tags;"instruments"->s.audio?.instruments?.map{it.name}.orEmpty();"language"->listOfNotNull(s.language);"mood"->s.mood;"theme"->s.theme
  "era"->s.year?.let{listOf((it/10*10).toString()+" 年代")}.orEmpty()
  "duration"->if(s.duration<=0)emptyList() else listOf(if(s.duration<180000)"3 分钟以内" else if(s.duration<300000)"3–5 分钟" else "5 分钟以上")
  "tempo"->s.audio?.bpm?.let{listOf(if(it<90)"舒缓" else if(it<130)"中速" else "快速")}.orEmpty()
  "timbre"->s.audio?.brightness?.let{listOf(if(it<1200)"偏温暖" else if(it<2500)"均衡" else "偏明亮")}.orEmpty()
  "vocal"->s.audio?.vocal?.let{listOf(if(it>=.5)"人声突出" else if(it>=.2)"人声与器乐交织" else "器乐为主")}.orEmpty()
  "dynamics"->s.audio?.dynamics?.let{listOf(if(it<.2)"平稳" else if(it<.6)"有起伏" else "变化明显")}.orEmpty()
  else->emptyList()
 }
 fun avoided(song:Song,s:Settings)=dimensionNames.keys.any{k->types(song,k).any{it in s.avoidTypes[k].orEmpty()}}
 fun distribution(library:List<Song>,key:String):Pair<Int,List<Pair<String,Int>>>{val eligible=library.filter{types(it,key).isNotEmpty()};return eligible.size to eligible.flatMap{types(it,key).distinct()}.groupingBy{it}.eachCount().toList().sortedByDescending{it.second}}
 fun lexical(song:Song,lyrics:String):Song {
  val text=lyrics.replace(Regex("\\[[^\\]]*\\]"),"").replace(Regex("(?m)^(作词|作曲|编曲|制作人|混音).*"),"").lowercase()
  val mood=mapOf("温暖" to listOf("温暖","阳光","拥抱","warm","gentle"),"忧伤" to listOf("难过","孤独","眼泪","寂寞","lonely","tears"),"希望" to listOf("希望","梦想","勇敢","未来","hope","dream"),"思念" to listOf("思念","想你","回忆","miss you","memories"))
  val theme=mapOf("爱情" to listOf("爱情","爱你","恋人","love","lover"),"离别" to listOf("再见","离开","告别","goodbye","farewell"),"自然" to listOf("山川","森林","海洋","星空","ocean","forest"),"成长" to listOf("长大","青春","童年","young","childhood"),"城市" to listOf("街道","城市","车站","city","street"))
  val language=when{Regex("[ぁ-んァ-ン]").containsMatchIn(text)->"日语";Regex("[가-힣]").containsMatchIn(text)->"韩语";Regex("[\\u4e00-\\u9fff]").findAll(text).count()>20->"中文";Regex("[a-z]+").findAll(text).count()>20->"英语";else->null}
  return song.copy(lyrics=lyrics,mood=mood.filterValues{v->v.count{text.contains(it)}>=2}.keys.toList(),theme=theme.filterValues{v->v.count{text.contains(it)}>=2}.keys.toList(),language=language)
 }
}
