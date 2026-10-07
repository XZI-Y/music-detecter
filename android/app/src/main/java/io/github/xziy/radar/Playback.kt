package io.github.xziy.radar

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.session.*
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService:MediaSessionService(){
 private var session:MediaSession?=null
 override fun onCreate(){super.onCreate();val repo=(application as RadarApp).repo;val urls=ConcurrentHashMap<Long,Pair<Uri,Long>>();var cacheOwner=repo.data.value.profile?.id
  val source=ResolvingDataSource.Factory(DefaultHttpDataSource.Factory().setUserAgent("RadarAndroid/1.0")){spec->
   if(spec.uri.scheme!="radar")spec else{
    if(cacheOwner!=repo.data.value.profile?.id){urls.clear();cacheOwner=repo.data.value.profile?.id}
    val id=spec.uri.lastPathSegment?.toLongOrNull()?:throw IOException("播放入口无效")
    try{val cached=urls[id];val uri=if(cached!=null&&cached.second>System.currentTimeMillis())cached.first else runBlocking{val playback=repo.api.playback(id);if(playback.second)repo.status.value="当前账号仅可播放试听片段";Uri.parse(playback.first).also{urls[id]=it to System.currentTimeMillis()+TimeUnit.MINUTES.toMillis(4)}};spec.withUri(uri)}catch(e:Exception){throw IOException(e.message?:"暂时无法播放",e)}
   }
  }
  val player=ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(source)).build()
  player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);player.setHandleAudioBecomingNoisy(true);player.setWakeMode(C.WAKE_MODE_LOCAL)
  player.addListener(object:Player.Listener{override fun onPlayerError(error:PlaybackException){repo.error.value="播放失败，请检查网络或账号权限；也可在网易云打开这首歌"}})
  session=MediaSession.Builder(this,player).setCallback(object:MediaSession.Callback{
   override fun onConnect(session:MediaSession,controller:MediaSession.ControllerInfo):MediaSession.ConnectionResult{
    if(!controller.isTrusted&&controller.packageName!=packageName)return MediaSession.ConnectionResult.reject()
    return super.onConnect(session,controller)
   }
  }).build()
 }
 override fun onGetSession(controllerInfo:MediaSession.ControllerInfo):MediaSession?=session
 override fun onDestroy(){session?.player?.release();session?.release();session=null;super.onDestroy()}
}
data class Playing(val song:Song?=null,val playing:Boolean=false,val position:Long=0,val duration:Long=0,val shuffle:Boolean=false,val queue:List<Song> = emptyList())
class PlayerConnection(private val context:Context,private val repo:Repository):AutoCloseable {
 val state=MutableStateFlow(Playing());private var controller:MediaController?=null
 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate);private val listener=object:Player.Listener{override fun onEvents(player:Player,events:Player.Events){refresh()}}
 private val future=MediaController.Builder(context,SessionToken(context,ComponentName(context,PlaybackService::class.java))).buildAsync()
 init{future.addListener({try{controller=future.get().also{it.addListener(listener)};refresh()}catch(_:Exception){repo.error.value="播放器暂未就绪，请重试"}},ContextCompat.getMainExecutor(context));scope.launch{while(isActive){refresh();delay(400)}}}
 private fun refresh(){val c=controller?:return;val id=c.currentMediaItem?.mediaId?.toLongOrNull();val queue=if(state.value.queue.isEmpty()){val saved=(repo.data.value.archive+repo.data.value.library+repo.data.value.recommendations).associateBy{it.id};(0 until c.mediaItemCount).mapNotNull{i->saved[c.getMediaItemAt(i).mediaId.toLongOrNull()]}} else state.value.queue;val song=queue.find{it.id==id};state.value=state.value.copy(queue=queue,song=song,playing=c.playWhenReady&&c.playbackState!=Player.STATE_ENDED,position=c.currentPosition.coerceAtLeast(0),duration=c.duration.takeIf{it>0}?:song?.duration?:0,shuffle=c.shuffleModeEnabled)}
 fun choose(song:Song,list:List<Song>){val c=controller;if(c==null){repo.error.value="播放器正在初始化，请稍后重试";return};val queue=list.ifEmpty{listOf(song)};val index=queue.indexOfFirst{it.id==song.id}.coerceAtLeast(0);state.value=state.value.copy(queue=queue);c.setMediaItems(queue.map{item->MediaItem.Builder().setMediaId(item.id.toString()).setUri("radar://song/"+item.id).setMediaMetadata(MediaMetadata.Builder().setTitle(item.name).setArtist(item.artistText).setArtworkUri(item.cover.takeIf{it.isNotEmpty()}?.let{Uri.parse(it)}).build()).build()},index,0);c.prepare();c.play()}
 fun toggle(){val c=controller?:return;if(c.mediaItemCount==0){val list=repo.data.value.recommendations.ifEmpty{repo.data.value.library};if(list.isNotEmpty())choose(list.first(),list) else repo.error.value="请先选择歌单并开始分析"}else if(c.playWhenReady)c.pause() else{if(c.playbackState==Player.STATE_ENDED)c.seekTo(0);if(c.playbackState==Player.STATE_IDLE)c.prepare();c.play()}}
 fun clear(){controller?.stop();controller?.clearMediaItems();state.value=Playing()}
 fun next(){controller?.seekToNextMediaItem()}
 fun previous(){controller?.seekToPreviousMediaItem()}
 fun shuffle(){controller?.let{it.shuffleModeEnabled=!it.shuffleModeEnabled}}
 fun seek(ms:Long){controller?.seekTo(ms);refresh()}
 override fun close(){scope.cancel();controller?.removeListener(listener);MediaController.releaseFuture(future)}
}
data class LyricLine(val time:Long,val text:String)
fun lyricLines(raw:String):List<LyricLine>{val regex=Regex("\\[(\\d+):(\\d+)(?:\\.(\\d+))?\\]");val result=mutableListOf<LyricLine>();for(line in raw.lines()){val words=line.replace(regex,"").trim();if(words.isEmpty())continue;for(match in regex.findAll(line)){val fraction=match.groupValues[3].padEnd(3,'0').take(3).toLongOrNull()?:0;result+=LyricLine(match.groupValues[1].toLong()*60000+match.groupValues[2].toLong()*1000+fraction,words)}};return result.sortedBy{it.time}}
fun clock(ms:Long):String {val sec=ms.coerceAtLeast(0)/1000;return (sec/60).toString()+":"+(sec%60).toString().padStart(2,'0')}
