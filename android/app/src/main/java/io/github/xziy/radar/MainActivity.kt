package io.github.xziy.radar

import android.Manifest
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.*
import java.io.File
import java.time.ZonedDateTime
import java.time.ZoneId

class MainActivity:ComponentActivity(){override fun onCreate(state:Bundle?){super.onCreate(state);enableEdgeToEdge();setContent{Radar()}}}

@Composable fun Radar(){
 val vm:RadarViewModel=viewModel();val repo=vm.repo;val data by repo.data.collectAsStateWithLifecycle();val busy by repo.busy.collectAsStateWithLifecycle();val status by repo.status.collectAsStateWithLifecycle();val error by repo.error.collectAsStateWithLifecycle();val message by vm.message.collectAsStateWithLifecycle()
 val context=LocalContext.current;val player=remember{PlayerConnection(context.applicationContext,repo)};DisposableEffect(player){onDispose{player.close()}};val playing by player.state.collectAsStateWithLifecycle()
 val dark=when(data.settings.mode){"dark"->true;"light"->false;else->isSystemInDarkTheme()};val accent=Color.hsl(data.settings.hue.toFloat(),.36f,if(dark).76f else .35f)
 LaunchedEffect(dark){(context as? android.app.Activity)?.let{activity->val controller=WindowCompat.getInsetsController(activity.window,activity.window.decorView);controller.isAppearanceLightStatusBars=!dark;controller.isAppearanceLightNavigationBars=!dark}}
 val colors=if(dark)darkColorScheme(primary=accent,onPrimary=Color(0xff142619),background=Color(0xff101813),surface=Color(0xff1b261f),onSurface=Color(0xffedf3e9),onBackground=Color(0xffedf3e9),surfaceVariant=Color(0xff28382c)) else lightColorScheme(primary=accent,background=Color(0xfff5f6ef),surface=Color.White,onSurface=Color(0xff1e3025),onBackground=Color(0xff1e3025),surfaceVariant=Color(0xffe8eee5))
 val palette=colors.copy(secondary=accent,tertiary=accent,primaryContainer=Color.hsl(data.settings.hue.toFloat(),.18f,if(dark).22f else .9f),secondaryContainer=Color.hsl(data.settings.hue.toFloat(),.18f,if(dark).22f else .9f),onPrimaryContainer=colors.onSurface,onSecondaryContainer=colors.onSurface)
 MaterialTheme(colorScheme=palette){
  var activeAccount by remember{mutableStateOf(data.profile?.id)}
  LaunchedEffect(data.profile?.id){if(activeAccount!=data.profile?.id){player.clear();activeAccount=data.profile?.id}}
  var page by rememberSaveableState{mutableStateOf(0)};var showPlayer by remember{mutableStateOf(false)};var showLogin by remember{mutableStateOf(false)}
  val snackbar=remember{SnackbarHostState()};val scope=rememberCoroutineScope();val notifications=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){}
  fun play(song:Song?=null){if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)notifications.launch(Manifest.permission.POST_NOTIFICATIONS);if(song!=null)player.choose(song,data.recommendations.ifEmpty{data.library}) else player.toggle()}
  LaunchedEffect(error,message){val text=message.ifEmpty{error};if(text.isNotEmpty()){snackbar.showSnackbar(text);vm.message.value="";repo.error.value=""}}
  LaunchedEffect(data.settings.favorite,data.profile?.id){if(data.profile!=null&&data.settings.favorite!=null)vm.run{repo.refreshFavorites()}}
  LaunchedEffect(playing.song?.id){val song=playing.song?:return@LaunchedEffect;if(song.lyrics.isEmpty())try{val lyric=repo.api.lyric(song.id);repo.update{it.copy(archive=it.archive.filterNot{s->s.id==song.id}+song.copy(lyrics=lyric))}}catch(_:Exception){}}
  Scaffold(
   containerColor=colors.background,snackbarHost={SnackbarHost(snackbar)},
   topBar={Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal=22.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){Image(painterResource(R.mipmap.radar),null,Modifier.size(30.dp).clip(RoundedCornerShape(9.dp)));Spacer(Modifier.width(9.dp));Text("雷达",fontWeight=FontWeight.Medium);Spacer(Modifier.weight(1f));TextButton(onClick={showLogin=true}){Text(data.profile?.name?:"连接网易云",maxLines=1,overflow=TextOverflow.Ellipsis)}}},
   bottomBar={Column{
    MiniPlayer(playing,liked(data,playing.song),{showPlayer=true},{play()},{playing.song?.let{s->vm.run{repo.favorite(s)}}})
    NavigationBar(containerColor=colors.background){val labels=listOf("今日","偏好","分析","设置");val icons=listOf(Icons.Outlined.Radar,Icons.Outlined.Insights,Icons.Outlined.QueueMusic,Icons.Outlined.Tune);labels.forEachIndexed{i,label->NavigationBarItem(selected=page==i,onClick={page=i},icon={Icon(icons[i],label)},label={Text(label)})}}
   }}
  ){padding->
   Column(Modifier.padding(padding).fillMaxSize()){
    if(busy){Column(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp)){LinearProgressIndicator(Modifier.fillMaxWidth());Row(verticalAlignment=Alignment.CenterVertically){Text(status,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);TextButton(onClick={vm.pause()}){Text("暂停")}}}}
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=22.dp).padding(bottom=24.dp)){
     when(page){
      0->Today(data,status,busy,{play()},{s->play(s)},{s->vm.run{repo.favorite(s)}},{s->repo.dislike(s)},{if(data.profile==null)showLogin=true else page=2},{vm.run{repo.generate()}},data.settings.material)
      1->Taste(data,{s->repo.settings(s)},data.settings.material)
      2->Analysis(data,busy,{showLogin=true},{vm.run{repo.playlists()}},{s->repo.settings(s)},{vm.run{repo.analyze();repo.schedule()}},{vm.run{repo.moreAnalysis()}},data.settings.material)
      3->SettingsPage(data,busy,{s->repo.settings(s)},vm,player,{showLogin=true},data.settings.material)
     }
    }
   }
  }
  if(showLogin)LoginDialog(vm,{showLogin=false})
  if(showPlayer)FullPlayer(player,playing,data,{showPlayer=false},{s->vm.run{repo.favorite(s)}},{play()},repo)
 }
}
@Composable private fun <T> rememberSaveableState(init:()->T)=remember { init() }
private fun liked(data:Data,song:Song?)=song!=null&&song.id in data.settings.favorite?.let{data.favorites[it]}.orEmpty()
@Composable fun Intro(eyebrow:String,title:String,subtitle:String=""){Spacer(Modifier.height(10.dp));Text(eyebrow,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(title,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.Medium,modifier=Modifier.padding(top=8.dp,bottom=14.dp));if(subtitle.isNotBlank())Text(subtitle,style=MaterialTheme.typography.bodySmall)}
@Composable fun Panel(material:String,hero:Boolean=false,content:@Composable ColumnScope.()->Unit){
 val shape=RoundedCornerShape(if(material=="paper")7.dp else 18.dp);val c=MaterialTheme.colorScheme
 val modifier=Modifier.fillMaxWidth().padding(vertical=7.dp).then(if(material=="glass")Modifier.background(Brush.linearGradient(listOf(c.surfaceVariant,c.surface)),shape) else Modifier.background(if(hero)c.primary.copy(alpha=.10f).compositeOver(c.surface) else c.surface,shape)).then(if(material=="glass")Modifier.border(.7.dp,c.primary.copy(alpha=.25f),shape) else Modifier)
 Column(modifier.clip(shape).then(if(hero)Modifier.drawBehind{val radius=size.width*.28f;val center=Offset(size.width*.88f,size.height*.24f);for(scale in listOf(1f,.72f,.45f))drawCircle(c.primary.copy(alpha=.12f),radius*scale,center,style=Stroke(.75.dp.toPx()))} else Modifier).padding(17.dp),content=content)
}
@Composable fun Cover(song:Song?,size:Dp=46.dp){
 Box(Modifier.size(size).clip(RoundedCornerShape(size/4)).background(MaterialTheme.colorScheme.surfaceVariant),contentAlignment=Alignment.Center){
  if(!song?.cover.isNullOrEmpty())AsyncImage(model=song!!.cover,contentDescription=null,contentScale=ContentScale.Crop,modifier=Modifier.fillMaxSize()) else Icon(Icons.Outlined.MusicNote,null,tint=MaterialTheme.colorScheme.primary,modifier=Modifier.size(size/2))
 }
}
@Composable fun Heart(isLiked:Boolean,onClick:()->Unit,enabled:Boolean=true){IconButton(onClick=onClick,enabled=enabled){Icon(if(isLiked)Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder,if(isLiked)"取消收藏" else "收藏到指定歌单",tint=if(isLiked)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable fun Today(d:Data,status:String,busy:Boolean,play:()->Unit,choose:(Song)->Unit,heart:(Song)->Unit,dislike:(Song)->Unit,setup:()->Unit,generate:()->Unit,material:String){
 val now=ZonedDateTime.now(ZoneId.of("Asia/Shanghai"));Intro(now.monthValue.toString()+" 月 "+now.dayOfMonth+" 日","今天，听点新鲜的。")
 Panel(material,hero=true){Text("为你发现",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary);Text("我可能喜欢",style=MaterialTheme.typography.headlineMedium,modifier=Modifier.padding(top=10.dp));Text("从熟悉的旋律，走向新的声音。",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(vertical=12.dp))
  if(d.recommendations.isNotEmpty())Button(onClick=play){Icon(Icons.Outlined.PlayArrow,null);Spacer(Modifier.width(6.dp));Text("开始播放")} else Button(onClick=setup){Text(if(d.profile==null)"连接网易云" else "选择歌单并开始分析")}
  if(d.lastUpdate.isNotEmpty()){val time=runCatching{ZonedDateTime.parse(d.lastUpdate).toLocalDateTime().toString().replace('T',' ').take(16)}.getOrDefault(d.lastUpdate.take(16));Text("实际更新："+time,style=MaterialTheme.typography.labelSmall,modifier=Modifier.padding(top=12.dp))}
  Text("每日 "+d.settings.hour+":00 后自动更新 · 下次打开会检查遗漏",style=MaterialTheme.typography.labelSmall,modifier=Modifier.padding(top=8.dp))
 }
 Row(Modifier.fillMaxWidth().padding(top=16.dp,bottom=8.dp),verticalAlignment=Alignment.CenterVertically){Text("今日发现 · "+d.recommendations.size+" 首",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);TextButton(onClick=generate,enabled=!busy&&d.analyzed){Icon(Icons.Outlined.Refresh,null,Modifier.size(16.dp));Text("换一批")}}
 if(d.recommendations.isEmpty())Text("先选择你想分析的歌单，雷达会从你的音乐偏好出发寻找新歌。",style=MaterialTheme.typography.bodyMedium)
 for(song in d.recommendations){
  var more by remember(song.id){mutableStateOf(false)}
  Row(Modifier.fillMaxWidth().padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically){Cover(song);Column(Modifier.weight(1f).clickable{choose(song)}.padding(start=12.dp)){Text(song.name,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodyLarge);Text(song.artistText,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
   Heart(liked(d,song),{heart(song)},!busy);Box{IconButton(onClick={more=true}){Icon(Icons.Outlined.MoreVert,"歌曲操作")};DropdownMenu(expanded=more,onDismissRequest={more=false}){DropdownMenuItem(text={Text("不感兴趣")},onClick={dislike(song);more=false});song.reasons.forEach{reason->DropdownMenuItem(text={Text(reason,style=MaterialTheme.typography.bodySmall)},onClick={more=false})}}}
 }
 }
 if(!busy&&status.isNotEmpty())Text(status,style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(top=8.dp))
}
@Composable fun MiniPlayer(p:Playing,isLiked:Boolean,open:()->Unit,toggle:()->Unit,heart:()->Unit){
 Surface(shape=RoundedCornerShape(15.dp),color=MaterialTheme.colorScheme.surface,modifier=Modifier.padding(horizontal=12.dp).fillMaxWidth()){
  Row(Modifier.padding(8.dp),verticalAlignment=Alignment.CenterVertically){Row(Modifier.weight(1f).clickable(onClick=open),verticalAlignment=Alignment.CenterVertically){Cover(p.song,38.dp);Column(Modifier.padding(start=10.dp)){Text(p.song?.name?:"选择一首，开始聆听",style=MaterialTheme.typography.bodySmall,maxLines=1,overflow=TextOverflow.Ellipsis);Text(p.song?.artistText?:"今日推荐",style=MaterialTheme.typography.labelSmall,maxLines=1,overflow=TextOverflow.Ellipsis)}};Heart(isLiked,heart,p.song!=null);IconButton(onClick=toggle){Icon(if(p.playing)Icons.Outlined.Pause else Icons.Outlined.PlayArrow,if(p.playing)"暂停" else "播放")}}
 }
}
@Composable fun Taste(d:Data,save:(Settings)->Unit,material:String){
 var factor by remember{mutableStateOf("style")};Intro("音乐里的你","我的偏好","已分析 "+d.library.size+" 首 · 音频已分析 "+d.library.count{it.audio!=null}+" 首 · 检出乐器 "+d.library.count{it.audio?.instruments?.isNotEmpty()==true}+" 首")
 if(d.library.isEmpty()){Panel(material){Text("完成歌单分析后，这里会保存你的音乐偏好。")};return}
 Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical=14.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){dimensionNames.forEach{(key,title)->FilterChip(selected=factor==key,onClick={factor=key},label={Text(title)})}}
 val distribution=Engine.distribution(d.library,factor)
 Panel(material){Text(dimensionNames[factor]+"偏好",style=MaterialTheme.typography.titleMedium);Text("基于 "+distribution.first+" 首有该项数据的歌曲；多标签占比可超过 100%",style=MaterialTheme.typography.labelSmall,modifier=Modifier.padding(vertical=8.dp));if(distribution.first==0)Text("该项数据尚不足。可在分析页继续补充，乐器与音色需要音频识别。",style=MaterialTheme.typography.bodySmall)
  distribution.second.take(12).forEach{(name,n)->val ratio=n.toFloat()/distribution.first;Row(Modifier.padding(top=14.dp)){Text(name,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);Text((ratio*100).toInt().toString()+"%",style=MaterialTheme.typography.bodySmall)};LinearProgressIndicator(progress={ratio},modifier=Modifier.fillMaxWidth().padding(top=8.dp).height(5.dp))}
 }
 Panel(material){Text("减少不喜欢的类型",style=MaterialTheme.typography.titleMedium);Text("选择后，下次推荐会减少这些类型。",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(vertical=8.dp))
  val names=(distribution.second.map{it.first}+d.settings.avoidTypes[factor].orEmpty()).distinct()
  for(name in names.take(40)){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Checkbox(checked=name in d.settings.avoidTypes[factor].orEmpty(),onCheckedChange={checked->val old=d.settings.avoidTypes[factor].orEmpty();save(d.settings.copy(avoidTypes=d.settings.avoidTypes+(factor to if(checked)(old+name).distinct() else old-name)))});Text(name,style=MaterialTheme.typography.bodySmall)}}
  Choice("筛选强度",d.settings.avoidStrength,listOf(60,85,100),{save(d.settings.copy(avoidStrength=it))}){if(it==100)"完全避开" else it.toString()+"%"}
 }
 if(d.analysisTime.isNotEmpty())Text("最近分析："+d.analysisTime.take(16).replace('T',' '),style=MaterialTheme.typography.labelSmall)
}
@Composable fun Analysis(d:Data,busy:Boolean,login:()->Unit,refresh:()->Unit,save:(Settings)->Unit,analyze:()->Unit,more:()->Unit,material:String){
 Intro("让雷达了解你的音乐","歌单分析")
 if(d.profile==null){Panel(material){Text("登录后选择歌单，登录本身不会开始分析。");Button(onClick=login){Text("连接网易云音乐")}};return}
 Row(verticalAlignment=Alignment.CenterVertically){Text(d.profile.name,Modifier.weight(1f));TextButton(onClick=refresh,enabled=!busy){Text("刷新歌单")}}
 Panel(material){Text("待分析的歌单 · 已选 "+d.settings.selected.size+" 个",style=MaterialTheme.typography.titleMedium)
  d.playlists.forEach{list->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Checkbox(checked=list.id in d.settings.selected,enabled=!busy,onCheckedChange={value->save(d.settings.copy(selected=if(value)(d.settings.selected+list.id).distinct() else d.settings.selected-list.id))});Column(Modifier.weight(1f)){Text(list.name,maxLines=2,style=MaterialTheme.typography.bodyMedium);Text(list.count.toString()+" 首",style=MaterialTheme.typography.labelSmall)}}}
  Button(onClick=analyze,enabled=!busy&&d.settings.selected.isNotEmpty(),modifier=Modifier.fillMaxWidth().padding(top=12.dp)){Text("开始分析")}
  if(d.analyzed)TextButton(onClick=more,enabled=!busy){Text("继续补充歌词与音频分析")}
 }
 Panel(material){Text("收藏目标",style=MaterialTheme.typography.titleMedium);val lists=d.playlists.filter{it.ownerId==d.profile.id};var expanded by remember{mutableStateOf(false)};Box{OutlinedButton(onClick={expanded=true},enabled=!busy){Text(lists.find{it.id==d.settings.favorite}?.name?:"请选择你的收藏歌单")};DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){lists.forEach{p->DropdownMenuItem(text={Text(p.name)},onClick={save(d.settings.copy(favorite=p.id));expanded=false})}}};Text("点爱心时写入这个网易云歌单。",style=MaterialTheme.typography.bodySmall)}
 Panel(material){Text("本轮音频分析",style=MaterialTheme.typography.titleMedium);val report=d.audioReport
  Text(when(report.state){"disabled"->"乐器识别未开启";"wifi_wait"->"正在等待 Wi-Fi，本轮未进行音频识别";"preparing"->"正在检查模型";"ready"->"模型已就绪，正在分析音频";"model_error"->"模型暂未就绪，下载进度及已有分析保留";"network_error"->"网易云连接失败，音频分析已暂停";"partial"->"部分音频未完成，可立即重试";"complete"->"本轮音频分析已结束";else->"尚未进行音频分析"},modifier=Modifier.padding(vertical=8.dp))
  Text("尝试 ${report.attempted} 首 · 完成 ${report.completed} 首 · 检出乐器 ${report.identified} 首 · 失败 ${report.failed} 首",style=MaterialTheme.typography.bodySmall)
  if(report.completed>report.identified)Text("已分析但未检出可靠乐器：${report.completed-report.identified} 首",style=MaterialTheme.typography.bodySmall)
  if(report.lastError.isNotEmpty())Text(report.lastError,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)
  if(d.analyzed)TextButton(onClick=more,enabled=!busy&&d.settings.deepAudio){Text("继续分析 / 重试未完成歌曲")}
 }
 Panel(material){SettingSwitch("备用域名解析",d.settings.fallbackDns,{save(d.settings.copy(fallbackDns=it))});Text("系统无法解析网易云域名时，尝试阿里公共 HTTPS DNS；仅查询域名，不发送账号信息。",style=MaterialTheme.typography.bodySmall)}
 Panel(material){SettingSwitch("乐器识别",d.settings.deepAudio,{save(d.settings.copy(deepAudio=it))});Text("首次下载约 91 MB 模型，随后在手机本地识别。",style=MaterialTheme.typography.bodySmall);SettingSwitch("模型和音频分析仅用 Wi-Fi",d.settings.wifiOnly,{save(d.settings.copy(wifiOnly=it))});Choice("每轮分析预算",d.settings.audioBatch,listOf(12,24,48,72),{save(d.settings.copy(audioBatch=it))}){it.toString()+" 首"}}
}
@Composable fun <T> Choice(title:String,value:T,options:List<T>,change:(T)->Unit,label:(T)->String={it.toString()}){
 var expanded by remember{mutableStateOf(false)};Row(Modifier.fillMaxWidth().padding(vertical=5.dp),verticalAlignment=Alignment.CenterVertically){Text(title,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);Box{TextButton(onClick={expanded=true}){Text(label(value),maxLines=1)};DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){options.forEach{option->DropdownMenuItem(text={Text(label(option))},onClick={change(option);expanded=false})}}}}
}
@Composable fun SettingSwitch(title:String,value:Boolean,change:(Boolean)->Unit){Row(Modifier.fillMaxWidth().padding(vertical=6.dp),verticalAlignment=Alignment.CenterVertically){Text(title,Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);Switch(checked=value,onCheckedChange=change)}}
@Composable fun SettingsPage(d:Data,busy:Boolean,save:(Settings)->Unit,vm:RadarViewModel,player:PlayerConnection,login:()->Unit,material:String){
 val s=d.settings;val context=LocalContext.current;val version=remember{context.packageManager.getPackageInfo(context.packageName,0).versionName.orEmpty()};val updater=remember{Updates(context,vm.repo.api)};var release by remember{mutableStateOf<UpdateRelease?>(null)};var downloaded by remember{mutableStateOf<File?>(null)};var updateText by remember{mutableStateOf("")};var logout by remember{mutableStateOf(false)}
 Intro("按照你的习惯","设置")
 Panel(material){Text("推荐",style=MaterialTheme.typography.titleMedium);Choice("每次推荐",s.count,listOf(10,20,30,50,100),{save(s.copy(count=it))}){it.toString()+" 首"};SettingSwitch("避开熟悉的歌手",s.avoidKnownArtists,{save(s.copy(avoidKnownArtists=it))});Choice("重复歌曲间隔",s.repeatDays,listOf(7,14,30,60),{save(s.copy(repeatDays=it))}){it.toString()+" 天"};Choice("同歌手最多",s.artistLimit,listOf(1,2,3),{save(s.copy(artistLimit=it))}){it.toString()+" 首"};Choice("同专辑最多",s.albumLimit,listOf(1,2,3,5),{save(s.copy(albumLimit=it))}){it.toString()+" 首"};Choice("每日更新时段",s.hour,(0..23).toList(),{save(s.copy(hour=it))}){it.toString()+":00"};Text("后台更新时间可能受系统省电影响。",style=MaterialTheme.typography.labelSmall)
  Text("探索比例 · "+s.exploration+"%",style=MaterialTheme.typography.bodySmall,modifier=Modifier.padding(top=14.dp));Slider(value=s.exploration.toFloat(),onValueChange={save(s.copy(exploration=it.toInt()))},valueRange=0f..100f)
  var weights by remember{mutableStateOf(false)};TextButton(onClick={weights=!weights}){Text(if(weights)"收起因素权重" else "推荐因素权重")};if(weights)weightNames.forEach{(key,title)->Text(title,style=MaterialTheme.typography.bodySmall);Slider(value=(s.weights[key]?:Engine.defaults[key]?:0.0).toFloat(),onValueChange={save(s.copy(weights=s.weights+(key to it.toDouble())))},valueRange=0f..1f)}
 }
 Panel(material){Text("外观",style=MaterialTheme.typography.titleMedium);Choice("模式",s.mode,listOf("system","dark","light"),{save(s.copy(mode=it))}){when(it){"dark"->"深色";"light"->"浅色";else->"跟随系统"}};Choice("材质",s.material,listOf("smooth","glass","paper"),{save(s.copy(material=it))}){when(it){"glass"->"毛玻璃";"paper"->"纸感";else->"光滑"}};Text("色调",style=MaterialTheme.typography.bodySmall);Slider(value=s.hue.toFloat(),onValueChange={save(s.copy(hue=it.toInt()))},valueRange=0f..360f)}
 Panel(material){Text("软件更新 · "+version,style=MaterialTheme.typography.titleMedium);TextButton(onClick={vm.run{release=updater.check();updateText=if(release==null)"当前没有可用的新版本" else "发现新版本 "+release!!.name}},enabled=!busy){Text("检查新版本")};if(updateText.isNotEmpty())Text(updateText,style=MaterialTheme.typography.bodySmall);release?.let{r->if(downloaded==null)Button(onClick={vm.run{vm.repo.operation{downloaded=updater.download(r){vm.repo.status.value=it}};updateText="下载完成，点击安装更新"}},enabled=!busy){Text("下载更新")} else Button(onClick={if(!updater.install(downloaded!!))updateText="请允许安装此来源的应用，然后再次点击安装更新"}){Text("安装更新")}}}
 Panel(material){if(d.profile==null)TextButton(onClick=login){Text("连接网易云")} else TextButton(onClick={logout=true},enabled=!busy){Text("退出账号")}}
 if(logout)AlertDialog(onDismissRequest={logout=false},title={Text("退出账号？")},text={Text("这台手机的账号和音乐资料会清除，网易云歌单不会删除。")},confirmButton={TextButton(onClick={logout=false;player.clear();vm.run{vm.repo.logout()}}){Text("退出")}},dismissButton={TextButton(onClick={logout=false}){Text("取消")}})
}
@Composable fun LoginDialog(vm:RadarViewModel,dismiss:()->Unit){
 var phone by remember{mutableStateOf("")};var country by remember{mutableStateOf("86")};var code by remember{mutableStateOf("")};var qrKey by rememberSaveable{mutableStateOf("")};var hint by remember{mutableStateOf("")};var cooldown by remember{mutableIntStateOf(0)};val busy by vm.repo.busy.collectAsStateWithLifecycle();val context=LocalContext.current
 LaunchedEffect(cooldown){if(cooldown>0){delay(1000);cooldown--}}
 val loginScope=rememberCoroutineScope();var connecting by remember{mutableStateOf(false)}
 fun perform(block:suspend()->Unit){if(connecting)return;loginScope.launch{connecting=true;try{block()}catch(e:CancellationException){throw e}catch(e:Exception){hint=e.message?:"连接失败，请重试"}finally{connecting=false}}}
 var qrAuthorized by rememberSaveable(qrKey){mutableStateOf(false)}
 var qrProblem by remember{mutableStateOf(false)};val owner=LocalLifecycleOwner.current;val latestDismiss by rememberUpdatedState(dismiss)
 LaunchedEffect(qrKey){if(qrKey.isNotEmpty())owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED){if(!qrProblem){try{
  if(!qrAuthorized){awaitQrConfirmation({vm.repo.api.qrCheck(qrKey)},{state->hint=when(state){801->"等待扫码，请在网易云中扫描二维码";802->"已扫码，请在网易云确认登录";803->"确认成功，正在读取账号…";else->"二维码已过期"}});qrAuthorized=true}
  connecting=true;vm.repo.finishQr();latestDismiss()
 }catch(e:CancellationException){throw e}catch(e:Exception){qrProblem=true;hint=e.message?:"扫码连接失败，请重新生成二维码"}finally{connecting=false}}}}
 val bitmap=remember(qrKey){if(qrKey.isEmpty())null else QRCodeWriter().encode("https://music.163.com/login?codekey="+qrKey,BarcodeFormat.QR_CODE,240,240).let{matrix->Bitmap.createBitmap(240,240,Bitmap.Config.ARGB_8888).apply{for(y in 0 until 240)for(x in 0 until 240)setPixel(x,y,if(matrix[x,y])android.graphics.Color.BLACK else android.graphics.Color.WHITE)}}}
 AlertDialog(onDismissRequest=dismiss,title={Text("连接网易云音乐")},text={Column(Modifier.verticalScroll(rememberScrollState())){
  if(bitmap==null){Row{OutlinedTextField(value=country,onValueChange={country=it.filter{c->c.isDigit()}.take(4)},label={Text("区号")},modifier=Modifier.width(80.dp),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number));Spacer(Modifier.width(8.dp));OutlinedTextField(value=phone,onValueChange={phone=it.filter{c->c.isDigit()}.take(15)},label={Text("手机号")},modifier=Modifier.weight(1f),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Phone))}
   OutlinedTextField(value=code,onValueChange={code=it.filter{c->c.isDigit()}.take(8)},label={Text("短信验证码")},modifier=Modifier.fillMaxWidth().padding(top=12.dp),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
   TextButton(onClick={perform{vm.repo.operation{vm.repo.api.sendCode(phone,country)};cooldown=60;hint="验证码已发送"}},enabled=!busy&&!connecting&&cooldown==0){Text(if(cooldown>0)cooldown.toString()+" 秒后重发" else "发送验证码")}
  }else{Image(bitmap.asImageBitmap(),"网易云登录二维码",Modifier.fillMaxWidth().height(220.dp));Text("在网易云中扫描并确认，也可保存后从相册识别。",style=MaterialTheme.typography.bodySmall);if(Build.VERSION.SDK_INT>=29)TextButton(onClick={try{val values=ContentValues().apply{put(MediaStore.Images.Media.DISPLAY_NAME,"雷达登录二维码.png");put(MediaStore.Images.Media.MIME_TYPE,"image/png");put(MediaStore.Images.Media.RELATIVE_PATH,"Pictures/Radar")};val uri=context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values)?:error("无法保存");context.contentResolver.openOutputStream(uri)?.use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};hint="已保存到相册"}catch(_:Exception){hint="保存失败，请重试"}}){Text("保存二维码")}}
  TextButton(onClick={if(qrKey.isNotEmpty()){qrKey="";qrProblem=false;hint=""}else perform{qrProblem=false;qrKey=vm.repo.api.qr();hint="等待扫码，请在网易云中确认登录"}},enabled=!busy&&!connecting){Text(if(qrKey.isEmpty())"使用二维码登录" else "使用短信登录")}
  if(hint.isNotEmpty())Text(hint,style=MaterialTheme.typography.bodySmall)
  }},confirmButton={TextButton(enabled=!busy&&!connecting&&(qrKey.isEmpty()||qrProblem),onClick={perform{if(qrKey.isEmpty()){vm.repo.login(phone,country,code);dismiss()} else{qrProblem=false;qrKey=vm.repo.api.qr();hint="等待扫码，请在网易云中确认登录"}}}){Text(if(connecting||busy)"连接中…" else if(qrKey.isEmpty())"完成登录" else if(qrProblem)"重新生成二维码" else "等待确认…")}},dismissButton={TextButton(onClick=dismiss){Text("取消")}})
}
@Composable fun FullPlayer(connection:PlayerConnection,p:Playing,data:Data,dismiss:()->Unit,heart:(Song)->Unit,toggle:()->Unit,repo:Repository){
 val song=p.song;val context=LocalContext.current;val raw=song?.let{s->data.archive.find{it.id==s.id}?.lyrics?.ifEmpty{s.lyrics}?:s.lyrics}.orEmpty();val lines=remember(raw){lyricLines(raw)};val current=lines.indexOfLast{it.time<=p.position}.coerceAtLeast(0);val lyricState=rememberLazyListState();var dragging by remember{mutableStateOf(false)};var seek by remember{mutableFloatStateOf(0f)};var queue by remember{mutableStateOf(false)}
 LaunchedEffect(current,lines){if(lines.isNotEmpty())lyricState.animateScrollToItem((current-1).coerceAtLeast(0))}
 Dialog(onDismissRequest=dismiss,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)){
  Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal=24.dp)){
   Row(verticalAlignment=Alignment.CenterVertically){IconButton(onClick=dismiss){Icon(Icons.Outlined.KeyboardArrowDown,"收起播放器")};Text("正在播放 · 雷达",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);Heart(liked(data,song),{song?.let(heart)},song!=null)}
   Box(Modifier.fillMaxWidth().padding(vertical=18.dp),contentAlignment=Alignment.Center){Cover(song,220.dp)}
   Text(song?.name?:"还没有播放音乐",style=MaterialTheme.typography.headlineSmall,maxLines=2,modifier=Modifier.align(Alignment.CenterHorizontally));Text(song?.artistText?:"选择一首开始",style=MaterialTheme.typography.bodySmall,modifier=Modifier.align(Alignment.CenterHorizontally).padding(vertical=8.dp))
   if(lines.isNotEmpty())LazyColumn(state=lyricState,modifier=Modifier.weight(1f).fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally){itemsIndexed(lines){i,line->Text(line.text,style=MaterialTheme.typography.bodyLarge,color=if(i==current)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(vertical=9.dp).clickable{connection.seek(line.time)})}} else Box(Modifier.weight(1f).fillMaxWidth(),contentAlignment=Alignment.Center){Text(if(raw.isNotBlank())raw else if(song==null)"播放后显示歌词" else "暂无同步歌词",style=MaterialTheme.typography.bodySmall)}
   Slider(value=if(dragging)seek else p.position.toFloat().coerceIn(0f,maxOf(1,p.duration).toFloat()),onValueChange={dragging=true;seek=it},onValueChangeFinished={connection.seek(seek.toLong());dragging=false},valueRange=0f..maxOf(1,p.duration).toFloat(),enabled=p.duration>0)
   Row{Text(clock(if(dragging)seek.toLong() else p.position),Modifier.weight(1f),style=MaterialTheme.typography.labelSmall);Text(clock(p.duration),style=MaterialTheme.typography.labelSmall)}
   Row(Modifier.fillMaxWidth().padding(vertical=20.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){IconButton(onClick={connection.shuffle()}){Icon(if(p.shuffle)Icons.Outlined.Shuffle else Icons.Outlined.Repeat,if(p.shuffle)"随机播放" else "顺序播放")};IconButton(onClick={connection.previous()}){Icon(Icons.Outlined.SkipPrevious,"上一首")};FilledIconButton(onClick=toggle,modifier=Modifier.size(60.dp)){Icon(if(p.playing)Icons.Outlined.Pause else Icons.Outlined.PlayArrow,if(p.playing)"暂停" else "播放")};IconButton(onClick={connection.next()}){Icon(Icons.Outlined.SkipNext,"下一首")};IconButton(onClick={queue=true}){Icon(Icons.Outlined.QueueMusic,"播放列表")}}
   TextButton(onClick={song?.let{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://music.163.com/#/song?id="+it.id)))}},modifier=Modifier.align(Alignment.CenterHorizontally),enabled=song!=null){Text("在网易云打开")}
  }}
 }
 if(queue)AlertDialog(onDismissRequest={queue=false},title={Text("播放列表")},text={Column(Modifier.verticalScroll(rememberScrollState())){p.queue.forEach{s->TextButton(onClick={connection.choose(s,p.queue);queue=false}){Text(s.name)}}}},confirmButton={TextButton(onClick={queue=false}){Text("关闭")}})
}
