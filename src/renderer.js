'use strict';
const $=id=>document.getElementById(id);let state,currentPage='today',historyDate,qrTimer,qrEpoch=0,toastTimer,settingsDirty=false,localBusy=false,seekDragging=false,currentPlayer;
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6000);}
async function request(action,data){const r=await window.music.request(action,data);if(!r.ok)throw new Error(r.error);return r.data;}
async function run(fn){try{return await fn();}catch(e){toast(e.message);return null;}}
function page(name){currentPage=name;document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!=='page-'+name));document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.page===name));$('page-label').textContent={today:'今日推荐',taste:'我的音乐',history:'历史歌单',settings:'设置'}[name];}
function time(seconds){return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');}
function setBusy(busy){localBusy=busy;$('progress').classList.toggle('hidden',!busy);for(const id of ['generate','qr-start','load-playlists','logout','clear','analyze-more','start-analysis'])$(id).disabled=busy;$('settings-form').querySelectorAll('input,select,button').forEach(e=>{if(!['check-update','download-update','install-update'].includes(e.id))e.disabled=busy;});}
function saved(songId){return state.favorites?.[state.settings.favoritePlaylist]?.includes(songId);}
async function favorite(songId){if(!state.settings.favoritePlaylist){page('settings');toast('请先选择爱心收藏的目标歌单');return;}state=await request('favorite',{id:songId,add:!saved(songId)});render();toast(saved(songId)?'已保存到网易云歌单':'已从网易云歌单移除');}
function songList(container,songs,date,today=false){
 container.replaceChildren();
 songs.forEach((song,index)=>{
  const row=element('article','song');row.append(element('span','song-number',String(index+1).padStart(2,'0')));
  const cover=element('div','cover','♫');
  if(/^https:\/\/[\w.-]+\.music\.126\.net\//.test(song.cover||'')){const img=element('img','cover');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=song.cover+(song.cover.includes('?')?'&':'?')+'param=100y100';img.onerror=()=>img.replaceWith(cover);row.append(img);}else row.append(cover);
  const info=element('div','song-info'),title=element('div','song-name',song.name);if(song.exploration)title.append(element('span','badge','新发现'));info.append(title,element('div','song-artist',song.artists.map(a=>a.name).join(' / ')+(song.album?' · '+song.album:'')));
  const reason=element('div','song-reason hidden',(song.reasons||[]).join('；'));info.append(reason);row.append(info);
  const actions=element('div','song-actions');
  function button(label,title,fn,cls='text-button'){const b=element('button',cls,label);b.title=title;b.onclick=()=>run(async()=>{b.disabled=true;try{await fn();}finally{b.disabled=false;}});actions.append(b);return b;}
  button('▶','播放',()=>request('playerPlay',{id:song.id,date}),'play-row');
  button(saved(song.id)?'♥':'♡','收藏到指定网易云歌单',()=>favorite(song.id),'text-button heart'+(saved(song.id)?' favorite':''));
  if(today)button('换一首','替换这首歌',async()=>{state=await request('replace',{id:song.id});renderSongs();});
  button('ⓘ','为什么推荐',()=>reason.classList.toggle('hidden'),'detail-button');
  button('×','不感兴趣',async()=>{state=await request('feedback',{id:song.id,value:state.feedback[song.id]?.value==='dislike'?'none':'dislike'});renderSongs();toast(state.feedback[song.id]?.value==='dislike'?'已记录不感兴趣':'已撤销反馈');});
  row.append(actions);container.append(row);
 });
}
function renderSongs(){
 const today=state.history.find(h=>h.date===state.today);
 songList($('today-songs'),today?.songs||[],state.today,true);
 $('welcome').classList.toggle('hidden',!!today?.songs.length&&state.settings.sourceConfirmed);
 $('welcome-title').textContent=!state.connected?'从你的歌单开始':!state.settings.sourceConfirmed?'选择你想分析的歌单':'可以开始寻找新音乐了';
 $('welcome-text').textContent=!state.settings.sourceConfirmed?'选择分析来源和爱心收藏的目标，保存后再开始。':'点击开始分析，为你准备第一份推荐。';
 $('welcome-connect').textContent=state.connected&&state.settings.sourceConfirmed?'开始分析 →':'开始设置 →';
 $('song-count').textContent=today?today.songs.length+' 首':'';
 $('hero-meta').textContent=today?'已更新 · '+new Date(today.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}):'';
 $('play-all').disabled=!today?.songs.length;$('export-today').disabled=!today;
 $('warnings').replaceChildren(...state.warnings.map(w=>element('div','',w)));
 const history=state.history.find(h=>h.date===historyDate)||state.history[0];
 if(history){historyDate=history.date;$('history-title').textContent=history.date;songList($('history-songs'),history.songs,history.date);}else{$('history-title').textContent='还没有历史歌单';$('history-songs').replaceChildren();}
 $('export-history').disabled=!history;$('history-dates').replaceChildren(...state.history.map(h=>{const b=element('button','date-button'+(h.date===historyDate?' active':''),h.date);b.onclick=()=>{historyDate=h.date;renderSongs();};return b;}));
}
function renderPlaylists(){
 const selected=new Set(state.settings.selected);$('playlist-list').replaceChildren();
 if(!state.playlists.length)$('playlist-list').append(element('p','muted','连接账号后，点击刷新歌单。'));
 for(const p of state.playlists){const label=element('label','playlist-item'),check=element('input');check.type='checkbox';check.value=p.id;check.checked=selected.has(p.id);check.onchange=()=>{settingsDirty=true;};label.dataset.name=p.name.toLowerCase();const info=element('div','',p.name);info.append(element('small','',(p.count||0)+' 首'));label.append(check,info);$('playlist-list').append(label);}
 $('favorite-playlist').replaceChildren(element('option','','请选择你的收藏歌单'));$('favorite-playlist').firstChild.value='';
 for(const p of state.playlists.filter(p=>p.ownerId===state.profile?.id)){const option=element('option','',p.name);option.value=p.id;$('favorite-playlist').append(option);}
 $('favorite-playlist').value=state.settings.favoritePlaylist||'';
}
function renderSettings(){
 if(settingsDirty)return;renderPlaylists();
 for(const [id,key] of [['setting-likes','includeLikes'],['setting-recent','includeRecent'],['setting-avoid','avoidKnownArtists'],['setting-audio','deepAudio'],['setting-floating','floating'],['setting-background','background'],['setting-startup','startup'],['setting-update','autoUpdate']])$(id).checked=!!state.settings[key];
 $('setting-count').value=state.settings.count;$('setting-hour').value=state.settings.syncHour;$('setting-exploration').value=state.settings.exploration;$('exploration-value').textContent=state.settings.exploration+'%';
}
function renderPlayer(p){
 if(!p)return;currentPlayer=p;$('player-title').textContent=p.song?.name||'还没有播放音乐';$('player-artist').textContent=p.song?.artists.map(a=>a.name).join(' / ')||'选择一首歌开始';$('player-toggle').textContent=p.paused?'▶':'Ⅱ';$('player-elapsed').textContent=time(p.time);$('player-duration').textContent=time(p.duration);
 if(!seekDragging){$('player-seek').max=p.duration||1;$('player-seek').value=p.time;}
 $('player-mode').textContent=p.mode==='shuffle'?'⤨':'→';$('player-mode').title=p.mode==='shuffle'?'随机播放':'顺序播放';$('player-message').textContent=p.error||(p.loading?'正在加载…':p.trial?'试听':'');$('player-volume').value=p.volume;
 $('player-heart').textContent=saved(p.song?.id)?'♥':'♡';$('player-heart').classList.toggle('favorite',!!saved(p.song?.id));
 for(const id of ['player-toggle','player-previous','player-next','player-heart'])$(id).disabled=!p.song;
}
function renderUpdate(value){if(!value)return;$('update-status').textContent=value.message;$('download-update').classList.toggle('hidden',value.status!=='available');$('install-update').classList.toggle('hidden',value.status!=='ready');}
function render(){
 $('account-name').textContent=state.connected?state.profile?.name||'已连接':'未连接网易云';$('version-label').textContent='v'+state.version;$('date-label').textContent=state.today;
 $('connection-text').textContent=state.connected?'已连接 '+(state.profile?.name||'网易云账号'):'用手机网易云音乐扫码连接。';$('logout').classList.toggle('hidden',!state.connected);$('qr-start').textContent=state.connected?'重新连接':'扫码连接';
 $('step-connect').classList.toggle('complete',state.connected);$('step-select').classList.toggle('complete',state.settings.sourceConfirmed);$('step-start').classList.toggle('complete',!!state.lastSync);$('source-status').textContent=state.settings.sourceConfirmed?'选择已保存':'选择后点击保存';
 renderSongs();renderSettings();renderPlayer(state.player);renderUpdate(state.update);setBusy(state.busy);
 const a=state.analysis||{metadata:state.libraryCount,lyrics:0,audio:0,pending:0};
 $('taste-stats').replaceChildren(...[[a.metadata,'已读取的歌曲'],[a.audio,'已识别音频特征'],[a.lyrics,'已提取歌词线索']].map(([value,label])=>{const card=element('div','stat');card.append(element('strong','',value),element('span','',label));return card;}));
 $('analysis-text').textContent=a.metadata?('已读取 '+a.metadata+' 首，音频特征已分析 '+a.audio+' 首'+(a.pending?'，其余 '+a.pending+' 首将继续分批分析。':'。')):'选择歌单后开始分析。';
 $('taste-tags').replaceChildren(...(state.taste.length?state.taste.map(t=>element('span','tag',t.tag)):[element('p','muted','还没有风格资料。')]));
}
async function refresh(){state=await request('state');render();}
async function loadPlaylists(){await request('playlists');settingsDirty=false;await refresh();}
async function saveSettings(){
 const selected=[...$('playlist-list').querySelectorAll('input:checked')].map(e=>Number(e.value));
 const settings={count:Number($('setting-count').value),exploration:Number($('setting-exploration').value),syncHour:Number($('setting-hour').value),selected,favoritePlaylist:Number($('favorite-playlist').value)||null,confirmSources:true};
 for(const [id,key] of [['setting-likes','includeLikes'],['setting-recent','includeRecent'],['setting-avoid','avoidKnownArtists'],['setting-audio','deepAudio'],['setting-floating','floating'],['setting-background','background'],['setting-startup','startup'],['setting-update','autoUpdate']])settings[key]=$(id).checked;
 state=await request('settings',settings);settingsDirty=false;render();toast('设置已保存');
}
async function generate(){
 if(!state.connected){page('settings');return startQr();}
 if(!state.settings.sourceConfirmed||settingsDirty){page('settings');toast('请先选择歌单并保存选择');if(!state.playlists.length)await loadPlaylists();return;}
 page('today');setBusy(true);$('progress-text').textContent='正在读取你选择的歌单…';try{state=await request('generate');render();toast('今日歌单已准备好');}finally{setBusy(false);}
}
function stopQr(){clearTimeout(qrTimer);qrTimer=null;qrEpoch++;}
async function startQr(){
 stopQr();const epoch=qrEpoch;$('qr-start').disabled=true;
 try{const result=await request('qr');if(epoch!==qrEpoch)return;if(!/^data:image\/(png|jpeg);base64,/.test(result.image||''))throw new Error('二维码生成失败，请重试');$('qr-image').src=result.image;$('qr-box').classList.remove('hidden');$('qr-status').textContent='请用手机网易云扫码';
  async function poll(){if(epoch!==qrEpoch)return;try{const r=await request('qrCheck');if(epoch!==qrEpoch)return;if(r.code===803){stopQr();$('qr-box').classList.add('hidden');settingsDirty=false;await refresh();page('settings');await run(loadPlaylists);toast('连接成功，请选择分析歌单和收藏目标');return;}if(r.code===800){stopQr();$('qr-status').textContent='二维码已过期，请重新连接';return;}$('qr-status').textContent=r.code===802?'请在手机上确认登录':'等待扫码…';qrTimer=setTimeout(poll,2500);}catch(e){stopQr();$('qr-status').textContent=e.message;}}
  qrTimer=setTimeout(poll,2500);
 }finally{$('qr-start').disabled=false;}
}
document.querySelectorAll('.nav').forEach(b=>{b.onclick=()=>page(b.dataset.page);});
$('generate').onclick=()=>run(generate);$('start-analysis').onclick=()=>run(async()=>{if(settingsDirty||!state.settings.sourceConfirmed)await saveSettings();await generate();});
$('welcome-connect').onclick=()=>run(async()=>{if(state.connected&&state.settings.sourceConfirmed&&!settingsDirty)return generate();page('settings');if(!state.connected)await startQr();else if(!state.playlists.length)await loadPlaylists();});
$('play-all').onclick=()=>run(async()=>{const h=state.history.find(h=>h.date===state.today);if(h?.songs.length)await request('playerPlay',{id:h.songs[0].id,date:h.date});});
$('qr-start').onclick=()=>run(startQr);$('load-playlists').onclick=()=>run(loadPlaylists);
$('settings-form').oninput=()=>{settingsDirty=true;};$('settings-form').onchange=()=>{settingsDirty=true;};$('settings-form').onsubmit=e=>{e.preventDefault();run(saveSettings);};
$('playlist-search').oninput=()=>{const q=$('playlist-search').value.trim().toLowerCase();$('playlist-list').querySelectorAll('.playlist-item').forEach(e=>e.classList.toggle('hidden',!e.dataset.name.includes(q)));};
$('setting-exploration').oninput=()=>{$('exploration-value').textContent=$('setting-exploration').value+'%';};
$('logout').onclick=()=>run(async()=>{stopQr();settingsDirty=false;state=await request('logout');render();toast('已退出连接');});
$('clear').onclick=()=>run(async()=>{stopQr();settingsDirty=false;state=await request('clear');render();});
$('unblock').onclick=()=>run(async()=>{state=await request('unblock');render();toast('已解除屏蔽');});
$('cancel').onclick=()=>run(async()=>{await request('cancel');$('progress-text').textContent='正在停止，已取得的音频特征会保留…';});
$('analyze-more').onclick=()=>run(async()=>{setBusy(true);try{state=await request('analyzeMore');render();}finally{setBusy(false);}});
$('export-today').onclick=()=>run(()=>request('export',{date:state.today}));$('export-history').onclick=()=>run(()=>request('export',{date:historyDate}));
for(const [id,type] of [['player-toggle','toggle'],['player-next','next'],['player-previous','previous']])$(id).onclick=()=>run(()=>request('playerCommand',{type}));
$('player-mode').onclick=()=>run(()=>request('playerCommand',{type:'mode',value:currentPlayer?.mode==='shuffle'?'sequence':'shuffle'}));
$('player-heart').onclick=()=>run(()=>currentPlayer?.song&&favorite(currentPlayer.song.id));
$('player-seek').onpointerdown=()=>{seekDragging=true;};$('player-seek').onchange=()=>{run(()=>request('playerCommand',{type:'seek',value:Number($('player-seek').value)}));seekDragging=false;};$('player-seek').onpointerup=()=>{seekDragging=false;};$('player-volume').oninput=()=>run(()=>request('playerCommand',{type:'volume',value:Number($('player-volume').value)}));
$('check-update').onclick=()=>run(async()=>renderUpdate(await request('checkUpdate')));$('download-update').onclick=()=>run(async()=>renderUpdate(await request('downloadUpdate')));$('install-update').onclick=()=>run(()=>request('installUpdate'));
for(let hour=0;hour<24;hour++){const o=element('option','',String(hour).padStart(2,'0')+':00');o.value=hour;$('setting-hour').append(o);}
window.music.onProgress(text=>{$('progress-text').textContent=text;if(!localBusy&&!state?.busy)toast(text);});window.music.onChanged(()=>run(refresh));window.music.onPlayer(renderPlayer);window.music.onUpdate(renderUpdate);
window.__previewFixture=()=>{
 state.connected=true;state.profile={id:42,name:'音乐爱好者'};state.settings.sourceConfirmed=true;state.settings.favoritePlaylist=99;state.favorites={99:[2]};
 state.history=[{date:state.today,createdAt:new Date().toISOString(),songs:[{id:1,name:'河岸的晚风',artists:[{id:11,name:'示例音乐人 A'}],album:'慢慢走',reasons:['可听到相近的原声吉他音色']},{id:2,name:'不眠城市',artists:[{id:12,name:'示例音乐人 B'}],album:'夜色',reasons:['节奏速度接近']},{id:3,name:'雨停之前',artists:[{id:13,name:'示例音乐人 C'}],album:'沿途',exploration:true,reasons:['与喜欢的歌曲风格接近']},{id:4,name:'春日来信',artists:[{id:14,name:'示例音乐人 D'}],album:'远方',reasons:['可听到相近的钢琴音色']}]}];
 state.player={song:state.history[0].songs[0],queue:state.history[0].songs,index:0,paused:false,loading:false,time:43,duration:226,volume:.8,mode:'sequence',error:'',trial:false};render();$('hero-meta').textContent='界面预览 · 虚构示例数据';page('today');
};
window.__smokeTest=async()=>{
 await refresh();const checks=[],check=(name,pass)=>checks.push({name,pass});
 check('首次启动要求设置来源',!state.settings.sourceConfirmed&&!$('welcome').classList.contains('hidden'));check('没有设计说明文字',!document.body.textContent.includes('歌手关联的加分'));
 const before=await request('state');const result=await window.music.request('generate');check('未确认来源不进行分析',!result.ok&&before.history.length===state.history.length);
 page('settings');check('歌单与收藏目标均需明确选择',$('favorite-playlist').value===''&&$('playlist-list').querySelectorAll('input:checked').length===0);
 check('播放器控件齐全',['player-toggle','player-next','player-heart','player-seek','player-duration','player-mode'].every(id=>!!$(id)));
 const invalid=await window.music.request('playerCommand',{type:'seek',value:-1});check('拒绝无效进度',!invalid.ok);
 const arbitrary=await window.music.request('arbitrary');check('拒绝未知调用',!arbitrary.ok);
 const hostile={id:999,name:'<img src=x onerror=alert(1)>',artists:[],reasons:['<script>alert(1)</script>']};songList($('history-songs'),[hostile],state.today);check('外部歌曲文字安全显示',$('history-songs').textContent.includes(hostile.name)&&!$('history-songs').querySelector('img,script'));
 window.__previewFixture();check('推荐行显示播放与爱心',$('today-songs').querySelectorAll('.play-row').length===4&&$('today-songs').querySelectorAll('.heart').length===4);
 check('播放器时间正确',$('player-elapsed').textContent==='0:43'&&$('player-duration').textContent==='3:46');
 await refresh();page('today');return {ok:checks.every(c=>c.pass),checks};
};
run(refresh);
