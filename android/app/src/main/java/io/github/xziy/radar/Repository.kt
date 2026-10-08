package io.github.xziy.radar

import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.ZonedDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

class RadarApp:Application(){val repo by lazy{Repository(this)}}
class Repository(val context:Context){
 val store=Store(context);val api=Netease(store,context)
 private val mutable=MutableStateFlow(store.read());val data=mutable.asStateFlow()
 val busy=MutableStateFlow(false);val status=MutableStateFlow("");val error=MutableStateFlow(store.readProblem)
 @Volatile private var activeOperation:Job?=null
 fun pause(){activeOperation?.cancel()}
 private val mutex=Mutex();private val saveScope=CoroutineScope(SupervisorJob()+Dispatchers.IO);private val saves=Channel<Unit>(Channel.CONFLATED)
 init{api.fallbackDns=data.value.settings.fallbackDns;saveScope.launch{for(signal in saves){delay(150);try{store.save(mutable.value)}catch(_:Exception){error.value="无法保存音乐资料，请检查手机剩余空间"}}}}
 @Synchronized fun update(f:(Data)->Data){mutable.value=f(mutable.value);saves.trySend(Unit)}
 fun settings(s:Settings){api.fallbackDns=s.fallbackDns;val old=data.value.settings;update{it.copy(settings=s,analyzed=if(s.selected!=old.selected)false else it.analyzed)};schedule()}
 suspend fun operation(block:suspend ()->Unit){mutex.withLock{activeOperation=currentCoroutineContext()[Job];busy.value=true;error.value="";try{withContext(Dispatchers.IO){block()}}catch(e:CancellationException){status.value="已暂停，已完成的分析会保留";throw e}catch(e:Exception){error.value=NetworkProblems.message(e);throw e}finally{activeOperation=null;busy.value=false}}}
 suspend fun login(phone:String,country:String,code:String){operation{connected(api.login(phone,country,code))}}
 suspend fun finishQr(){operation{connected(api.account())}}
 private suspend fun connected(profile:Profile){val lists=api.playlists(profile.id);update{old->if(old.profile?.id!=profile.id)Data(profile=profile,playlists=lists,settings=old.settings.copy(selected=emptyList(),favorite=null)) else old.copy(profile=profile,playlists=lists)}}
 suspend fun playlists(){operation{connected(api.account())}}
 suspend fun refreshFavorites(){operation{val d=data.value;val target=d.settings.favorite?:return@operation;check(d.playlists.any{it.id==target&&it.ownerId==d.profile?.id}){"请指定自己的收藏歌单"};val ids=Netease.objects(api.playlist(target).optJSONArray("trackIds")).map{it.optLong("id")};update{it.copy(favorites=it.favorites+(target to ids))}}}
 suspend fun favorite(song:Song){operation{val d=data.value;val target=d.settings.favorite?:kotlin.error("请先指定收藏歌单");check(d.playlists.any{it.id==target&&it.ownerId==d.profile?.id}){"收藏目标需要是你自己的歌单"};val remote=Netease.objects(api.playlist(target).optJSONArray("trackIds")).map{it.optLong("id")};val add=song.id !in d.favorites[target].orEmpty();if((song.id in remote)!=add)api.favorite(song.id,target,add,d.playlists.find{it.id==target}?.specialType==5);update{current->val ids=remote;current.copy(favorites=current.favorites+(target to if(add)(ids+song.id).distinct() else ids-song.id),feedback=if(add)current.feedback+(song.id to "like") else current.feedback)};status.value=if(add)"已收藏到指定网易云歌单" else "已从指定网易云歌单移除"}}
 fun dislike(song:Song){update{it.copy(feedback=it.feedback+(song.id to "dislike"),recommendations=it.recommendations.filterNot{s->s.id==song.id})}}
 suspend fun analyze(){operation{
  val d=data.value;check(d.profile!=null){"请先登录网易云"};check(d.settings.selected.isNotEmpty()){"请先选择待分析的歌单"}
  check(d.settings.selected.all{id->d.playlists.any{it.id==id}}){"所选歌单已失效，请刷新歌单"}
  val old=(d.archive+d.library).associateBy{it.id};val songs=linkedMapOf<Long,Song>()
  for(id in d.settings.selected){ensureActive();for(song in api.fullPlaylist(id,old){status.value=it}){val existing=songs[song.id];songs[song.id]=if(existing!=null)song.copy(tags=(song.tags+existing.tags).distinct()) else song}}
  check(songs.isNotEmpty()){"所选歌单没有可分析歌曲"}
  update{it.copy(library=songs.values.toList(),archive=(it.archive+songs.values).associateBy{v->v.id}.values.toList())}
  enrichLibrary(d.settings)
  val time=ZonedDateTime.now().toString();update{it.copy(analyzed=true,analysisTime=time,analysisHistory=(it.analysisHistory+time).takeLast(100))}
  status.value="歌单分析完成";generateInternal()
 }}
 private suspend fun ensureActive(){currentCoroutineContext().ensureActive()}
 private fun wifi():Boolean{val manager=context.getSystemService(ConnectivityManager::class.java);return manager.getNetworkCapabilities(manager.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)==true}
 private suspend fun enrichLibrary(settings:Settings,manualRetry:Boolean=false){
  val budget=settings.audioBatch.coerceIn(12,72);var lyrics=0;var report=AudioReport(state=if(!settings.deepAudio)"disabled" else if(settings.wifiOnly&&!wifi())"wifi_wait" else "preparing")
  val model=if(settings.deepAudio&&(!settings.wifiOnly||wifi()))AudioAnalyzer(context,api){status.value=it} else null
  fun publish(){update{it.copy(audioReport=report)}}
  publish()
  try{
   if(model!=null)try{status.value="正在检查音频模型";model.ensureReady();report=report.copy(state="ready");publish()}catch(e:CancellationException){throw e}catch(e:Exception){report=report.copy(state="model_error",lastError=NetworkProblems.message(e));publish();return}
   val ordered=data.value.library.sortedWith(compareBy<Song>{if(data.value.audioAttempts[it.id]==day())1 else 0}.thenBy{if(it.audio==null)0 else 1})
   for(song in ordered){ensureActive();var next=song
    if(song.lyrics.isEmpty()&&song.id !in data.value.lyricsChecked&&lyrics<budget){lyrics++;status.value="分析歌词 · "+lyrics+" / "+budget
     try{next=Engine.lexical(next,api.lyric(song.id));update{it.copy(lyricsChecked=(it.lyricsChecked+song.id).distinct())}}catch(e:CancellationException){throw e}catch(e:Exception){if(NetworkProblems.dns(e)){report=report.copy(state="network_error",lastError=NetworkProblems.message(e));publish();break}}
    }
    val needsAudio=next.audio?.model!=AudioAnalyzer.VERSION
    val retryAllowed=manualRetry||data.value.audioAttempts[next.id]!=day()
    if(model!=null&&needsAudio&&retryAllowed&&report.attempted<budget){
     report=report.copy(attempted=report.attempted+1);status.value="识别乐器 · "+report.attempted+" / "+budget;publish()
     try{next=next.copy(audio=model.analyze(next.id));report=report.copy(completed=report.completed+1,identified=report.identified+if(next.audio!!.instruments.isNotEmpty())1 else 0);update{it.copy(audioAttempts=it.audioAttempts-song.id)}}catch(e:CancellationException){throw e}catch(e:Exception){report=report.copy(failed=report.failed+1,lastError=NetworkProblems.message(e));if(NetworkProblems.dns(e)){report=report.copy(state="network_error");publish();break};update{it.copy(audioAttempts=it.audioAttempts+(song.id to day()))}}
     publish()
    }
    if(next!=song){val saved=next;update{it.copy(library=it.library.map{s->if(s.id==saved.id)saved else s},archive=(it.archive.filterNot{s->s.id==saved.id}+saved))}}
   }
   if(report.state=="ready")report=report.copy(state=if(report.failed>0)"partial" else "complete")
   publish()
  }finally{model?.close()}
 }
 suspend fun moreAnalysis(){operation{check(data.value.analyzed){"请先完成歌单分析"};enrichLibrary(data.value.settings,manualRetry=true);status.value="本轮分析结束，详细结果已保存在分析页"}}
 suspend fun generate(){operation{generateInternal()}}
 private suspend fun generateInternal(){
  val d=data.value;check(d.analyzed&&d.library.isNotEmpty()){"请先选择歌单并开始分析"};check(api.account().id==d.profile?.id){"账号已变化，请重新连接"};status.value="查找新的音乐"
  val candidates=linkedMapOf<Long,Song>();val errors=mutableListOf<String>()
  suspend fun safe(block:suspend()->Unit){try{block()}catch(e:CancellationException){throw e}catch(e:Exception){errors+=e.message?:"网络错误"}}
  val seeds=d.library.sortedBy{Engine.hash(day()+":"+d.generations+":"+it.id)}.take(16)
  for((index,s) in seeds.withIndex()){ensureActive();status.value="寻找相近歌曲 · "+(index+1)+" / "+seeds.size;safe{api.similar(s.id).forEach{next->val old=candidates[next.id];candidates[next.id]=if(old==null)next else old.copy(seedIds=(old.seedIds+next.seedIds).distinct())}}}
  safe{api.daily().forEach{candidates.putIfAbsent(it.id,it)}}
  val tags=d.library.flatMap{it.tags}.groupingBy{it}.eachCount().toList().sortedByDescending{it.second}.take(5).map{it.first}.ifEmpty{listOf("全部")}
  for(tag in tags){ensureActive();status.value="探索 "+tag+" 歌单";safe{for(id in api.discover(tag,(Engine.hash(day()+":"+d.generations+":"+tag)%3*8).toInt()).take(2)){val p=api.playlist(id);val ids=Netease.objects(p.optJSONArray("trackIds")).map{it.optLong("id")};if(ids.isNotEmpty()){val offset=(Engine.hash(day()+":"+d.generations+":"+id)%maxOf(1,ids.size-59)).toInt();api.details(ids.drop(offset).take(60),listOf(tag)).forEach{candidates.putIfAbsent(it.id,it)}}}}}
  check(candidates.isNotEmpty()){errors.firstOrNull()?:"没有获取到候选歌曲，请检查网络后重试"}
  val cached=d.archive.associateBy{it.id};var enriched=candidates.values.map{s->cached[s.id]?.let{old->s.copy(audio=old.audio,lyrics=old.lyrics,mood=old.mood,theme=old.theme,language=old.language)}?:s}
  var processed=0;val priority=enriched.sortedByDescending{it.seedIds.isNotEmpty()}.take(d.settings.audioBatch/2)
  val audio=if(d.settings.deepAudio&&(!d.settings.wifiOnly||wifi()))AudioAnalyzer(context,api){status.value=it} else null
  try{for(s in priority){ensureActive();processed++;var next=s;status.value="分析候选歌曲 · "+processed+" / "+priority.size
    if(next.lyrics.isEmpty())safe{next=Engine.lexical(next,api.lyric(next.id))}
    if(audio!=null&&next.audio==null)safe{next=next.copy(audio=audio.analyze(next.id))}
    val saved=next;enriched=enriched.map{if(it.id==saved.id)saved else it};if(saved.audio!=null||saved.lyrics.isNotEmpty())update{it.copy(archive=it.archive.filterNot{v->v.id==saved.id}+saved)}
  }}finally{audio?.close()}
  val current=data.value;val ctx=currentCoroutineContext();val result=Engine.recommend(enriched,current,checkpoint={ctx.ensureActive()});ctx.ensureActive();check(result.isNotEmpty()){"本轮没有符合筛选和去重条件的新歌。已有歌单保留，可调整筛选后重试"}
  update{it.copy(recommendations=result,history=(it.history+Exposure(day(),result.map{s->s.id},result.map{Engine.identity(it)})).takeLast(500),generations=it.generations+1,recommendationDate=day(),lastUpdate=ZonedDateTime.now(ZoneId.of("Asia/Shanghai")).toString())}
  status.value="已更新 "+result.size+" 首"+if(result.size<d.settings.count)" · 符合条件的候选不足，未重复填充" else ""
 }
 suspend fun dailyIfNeeded(){val d=data.value;if(d.analyzed&&d.profile!=null&&d.recommendationDate!=day()&&ZonedDateTime.now(ZoneId.of("Asia/Shanghai")).hour>=d.settings.hour)generate()}
 suspend fun logout(){mutex.withLock{store.cookie("");update{Data(settings=it.settings.copy(selected=emptyList(),favorite=null))};WorkManager.getInstance(context).cancelUniqueWork("radar-daily")}}
 fun schedule(){val d=data.value;if(!d.analyzed||d.profile==null)return;val work=PeriodicWorkRequestBuilder<DailyWorker>(1,TimeUnit.HOURS).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).setRequiresBatteryNotLow(true).build()).build();WorkManager.getInstance(context).enqueueUniquePeriodicWork("radar-daily",ExistingPeriodicWorkPolicy.UPDATE,work)}
}
class DailyWorker(context:Context,parameters:WorkerParameters):CoroutineWorker(context,parameters){override suspend fun doWork():Result=try{val repo=(applicationContext as RadarApp).repo;repo.dailyIfNeeded();repo.schedule();Result.success()}catch(_:CancellationException){throw CancellationException()}catch(_:Exception){Result.retry()}}
class RadarViewModel(app:Application):AndroidViewModel(app){val repo=(app as RadarApp).repo;val message=MutableStateFlow("");private var operation:Job?=null
 fun run(block:suspend()->Unit){operation=viewModelScope.launch{try{block()}catch(_:CancellationException){}catch(e:Exception){message.value=NetworkProblems.message(e)}}}
 fun pause(){operation?.cancel();repo.pause()}
 init{repo.schedule();run{repo.dailyIfNeeded()}}
}
