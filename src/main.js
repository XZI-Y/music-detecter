'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, Tray, Menu, nativeImage, Notification, dialog, screen, net, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { Connector } = require('./connector');
const { recommend, taste, dateKey } = require('./engine');
const {AudioAnalysis}=require('./analysis');
const {statistics,recordAnalysis,archiveSongs}=require('./statistics');
const {clampBounds,dockBounds,bubbleBounds,expandBounds}=require('./floating-layout');
const {PlayerController}=require('./player-controller');
const {configureUpdates}=require('./updater');
const {dailyStatus,recordSeen,dailyRetry}=require('./daily');
const {validateAvoidance}=require('./music-types');
const appearance=require('./appearance');
const {LyricsController}=require('./lyrics-controller');
const recommendationSettings=require('./recommendation-settings');
const {Assistant}=require('./assistant');
let assistant;
let lyricService,appearancePreview=null;
const originalLog = console.log;
console.log = (...args) => { if (args[0] === '[ERR]') originalLog('[网易云接口暂不可用]'); else originalLog(...args); };
app.setName('雷达');
app.setPath('userData',path.join(app.getPath('appData'),'听见新喜欢'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let win, playerWindow, decodeWindow, bubble, player, audioAnalysis, updates, store, connector, mediaConnector, cookie = '', busy = false, quitting = false, tray, qrKey = '', qrBusy = false, qrGeneration = 0, candidateCache = [], nextAttempt = 0;
let decodeSequence=0,backgroundAnalysisAt=0,floatingExpanded=false,floatingDrag=null;const decodePending=new Map(),favoritePending=new Set();
const smoke = process.argv.includes('--smoke-test');
if (smoke) {
  app.commandLine.appendSwitch('in-process-gpu');
  if (process.argv.includes('--test-renderer')) app.commandLine.appendSwitch('no-sandbox');
}
const smokeDirArg = process.argv.find(a => a.startsWith('--test-data='));
if (smokeDirArg) app.setPath('userData', smokeDirArg.slice(12));
const credentialPath = () => path.join(app.getPath('userData'), 'account.bin');
function progress(message) { if (win && !win.isDestroyed()) win.webContents.send('music:progress', message); }
function uiWindows(){return [win,bubble].filter(w=>w&&!w.isDestroyed());}
function changed() { for(const w of uiWindows())w.webContents.send('music:changed'); }
function snapshot() {
  const d = store.data;
  return { ...d, settings:{...d.settings,appearance:appearancePreview||d.settings.appearance},lyrics:lyricService?.snapshot(), assistant:assistant?.snapshot(), library: undefined, likedIds: undefined, analysisArchive:undefined, seenRecommendations:undefined, daily:dailyStatus(d,!!cookie,busy), musicStatistics:statistics(d), floating:{mode:d.settings.floatingMode||"dock",expanded:!!floatingExpanded}, feedback: Object.fromEntries(Object.entries(d.feedback).map(([k, v]) => [k, { value: v.value }])), connected: !!cookie, libraryCount: d.library.length, likedCount: d.likedIds.length, taste: taste(d.library), busy, today: dateKey(), player:player?.snapshot(),update:updates?.snapshot(),version:app.getVersion() };
}
function saveCookie(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储暂不可用，无法安全保存登录。请稍后重试。');
  let encrypted;
  try {
    encrypted = safeStorage.encryptString(value);
    if (safeStorage.decryptString(encrypted) !== value) throw new Error('roundtrip');
  } catch { throw new Error('Windows 无法安全保存登录凭据，请以当前 Windows 用户正常启动软件后重试。'); }
  fs.writeFileSync(credentialPath() + '.tmp', encrypted);
  fs.renameSync(credentialPath() + '.tmp', credentialPath());
  cookie = value;
}
function readCookie() {
  try { if (safeStorage.isEncryptionAvailable() && fs.existsSync(credentialPath())) cookie = safeStorage.decryptString(fs.readFileSync(credentialPath())); }
  catch { store.data.warnings.push('登录凭据无法读取，请重新扫码连接。'); }
}
function id(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('无效的歌曲或歌单编号'); return n; }
function currentSong(songId) { return store.data.history.flatMap(h => h.songs).find(s => s.id === songId) || store.data.library.find(s => s.id === songId); }
async function generate(force = false) {
  if (busy) throw new Error('正在更新，请等待完成');
  if (!cookie) throw new Error('请先扫码连接网易云音乐');
  if(!store.data.settings.sourceConfirmed||!store.data.settings.selected.length)throw new Error('请先选择分析歌单并保存选择');
  if(force){store.data.settings.analysisStarted=true;store.save();}
  const date = dateKey();
  if (!force && store.data.history.some(h => h.date === date)) return snapshot();
  busy = true;store.data.generationNumber=(store.data.generationNumber||0)+1;store.data.dailyUpdate={status:"updating",date,lastAttemptAt:new Date().toISOString()};store.save();changed();
  connector.cancelled = false;
  try {
    const draft = structuredClone(store.data);
    const synced = await connector.sync(draft);
    Object.assign(draft, synced);
    archiveSongs(store.data,draft.library);store.save();draft.analysisArchive=store.data.analysisArchive;
    const { candidates, warnings } = await connector.candidates(draft);
    draft.library=draft.library.map(s=>audioAnalysis.attach(s));archiveSongs(store.data,draft.library);store.save();
    let enrichedCandidates=candidates.map(s=>audioAnalysis.attach(s));
    if(draft.settings.deepAudio){
      const seedBatch=await audioAnalysis.batch(draft.library.map(s=>({...s,analysisRole:'source'})),Math.max(4,Math.floor(draft.settings.audioBatch/3)));
      draft.library=seedBatch.songs;
      const candidateBatch=await audioAnalysis.batch(enrichedCandidates,draft.settings.audioBatch-Math.max(4,Math.floor(draft.settings.audioBatch/3)));
      enrichedCandidates=candidateBatch.songs;
      if(seedBatch.failed+candidateBatch.failed)warnings.push('部分音源无法分析，已保留其他可用特征。');
    }
    const songs = recommend(enrichedCandidates, draft, date);
    if (!songs.length) throw new Error('本次候选已收藏、被排除或近期推荐过，没有足够的新歌。可调整歌单来源后重试。');
    if (songs.length < draft.settings.count) warnings.push(`本次找到 ${songs.length} 首符合筛选条件的新歌，未用重复歌曲凑满。`);
    // Respect feedback and settings received during asynchronous fetches.
    if (connector.cancelled) throw new Error('操作已取消');
    draft.feedback = store.data.feedback;
    draft.favorites = store.data.favorites;
    draft.blockedArtists = store.data.blockedArtists;
    draft.settings = store.data.settings;
    const finalSongs = recommend(enrichedCandidates, draft, date);
    if (!finalSongs.length) throw new Error('候选已被筛选排除，请调整来源后重试。');
    recordSeen(draft,finalSongs);
    draft.dailyUpdate={status:'success',date,lastAttemptAt:store.data.dailyUpdate.lastAttemptAt};
    draft.history = [{ date, createdAt: new Date().toISOString(), exploration:draft.settings.exploration,songs: finalSongs }, ...draft.history.filter(h => h.date !== date)].slice(0, 90);
    draft.warnings = [...new Set(warnings)];
    draft.analysis=analysisCounts(draft.library);recordAnalysis(draft);
    store.data = draft; store.save(); candidateCache = enrichedCandidates;
    progress('今日歌单已更新');
    return snapshot();
  } catch(e){store.data.dailyUpdate={status:'error',date,message:e.message,nextRetryAt:new Date(Date.now()+300000).toISOString(),lastAttemptAt:store.data.dailyUpdate.lastAttemptAt};store.save();throw e;} finally { busy = false; changed(); }
}
function analysisCounts(library){return {metadata:library.length,lyrics:library.filter(s=>s.features?.language||s.features?.lyricAnalyzed).length,audio:library.filter(s=>s.features?.audio).length,pending:library.filter(s=>!s.features?.audio).length};}
async function analyzeMore(){
  if(busy)throw new Error('正在更新，请稍后再试');if(!store.data.settings.sourceConfirmed||!store.data.library.length)throw new Error('先选择歌单并完成首次分析');
  busy=true;connector.cancelled=false;changed();
  try{
    const songs=[];
    let lyricBudget=store.data.settings.audioBatch;for(const song of store.data.library){if(connector.cancelled)throw new Error('操作已取消');if(!song.features?.lyricAnalyzed&&lyricBudget>0){const enriched=await connector.enrich(song);archiveSongs(store.data,[enriched]);songs.push(enriched);lyricBudget--;}else songs.push(song);}
    const result=await audioAnalysis.batch(songs.map(s=>({...s,analysisRole:'source'})),store.data.settings.audioBatch);
    store.data.library=result.songs;store.data.analysis=analysisCounts(result.songs);recordAnalysis(store.data);store.save();progress(`已识别 ${store.data.analysis.audio} 首歌曲的音频特征`);return snapshot();
  }finally{store.save();busy=false;changed();}
}
function helperWindow(file,preload){
  const w=new BrowserWindow({show:false,width:640,height:480,webPreferences:{preload:path.join(__dirname,preload),contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());
  const ready=new Promise((resolve,reject)=>{w.webContents.once('did-finish-load',resolve);w.webContents.once('did-fail-load',()=>reject(new Error('播放器未能启动')));});
  w.loadFile(path.join(__dirname,file));return {window:w,ready};
}
async function fetchAudio(url){
  const response=await net.fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('音源暂不可用');
  const reader=response.body.getReader();const parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24*1024*1024){await reader.cancel();throw new Error('音源过大，本次跳过分析');}parts.push(Buffer.from(value));}
  return Buffer.concat(parts);
}
function setupBubble(){
  if(!store.data.settings.floating){bubble?.destroy();bubble=null;return;}
  if(bubble&&!bubble.isDestroyed())return;
  const mode=store.data.settings.floatingMode||'dock',position=store.data.settings.floatingPosition;
  const area=position?screen.getDisplayNearestPoint(position).workArea:screen.getPrimaryDisplay().workArea;
  const bounds=mode==='dock'?dockBounds(area):bubbleBounds(position?.x||area.x+area.width-50,position?.y||area.y+area.height-50,area);
  floatingExpanded=false;
  bubble=new BrowserWindow({...bounds,frame:false,transparent:true,resizable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  bubble.setAlwaysOnTop(true,'floating');bubble.webContents.setWindowOpenHandler(()=>({action:'deny'}));bubble.webContents.on('will-navigate',e=>e.preventDefault());bubble.loadFile(path.join(__dirname,'floating.html'));
  bubble.webContents.once('did-finish-load',notifyFloating);
  bubble.on('closed',()=>{bubble=null;floatingDrag=null;});
}
function notifyFloating(){if(bubble&&!bubble.isDestroyed())bubble.webContents.send('music:floating',{mode:store.data.settings.floatingMode||'dock',expanded:floatingExpanded});}
async function loadPlaylists(){
  if(!cookie)throw new Error('请先连接账号');connector.cancelled=false;
  store.data.playlists=await connector.playlists((await connector.account()).id);
  const target=store.data.settings.favoritePlaylist;
  if(target)try{const p=await connector.call('playlist_detail',{id:target});store.data.favorites[target]=(p.playlist?.trackIds||[]).map(s=>Number(s.id));}catch{}
  store.save();changed();return store.data.playlists;
}
async function favoriteSong(songId,desired){
  if(qrKey||qrBusy)throw new Error('正在连接账号，请完成后再收藏');
  if(!cookie)throw new Error('请先连接网易云');const target=store.data.settings.favoritePlaylist;
  const list=store.data.playlists.find(p=>p.id===target&&p.ownerId===store.data.profile?.id);
  if(!list)throw new Error('请先指定可写入的收藏歌单');if(!currentSong(songId))throw new Error('歌曲不存在');
  if(favoritePending.has(songId))throw new Error('正在同步收藏，请稍后');favoritePending.add(songId);
  try{
    const remote=await mediaConnector.call('playlist_detail',{id:target});
    if(!Array.isArray(remote.playlist?.trackIds))throw new Error('暂时无法读取收藏歌单，请稍后重试');
    const previous=new Set(remote.playlist.trackIds.map(s=>Number(s.id))),add=typeof desired==='boolean'?desired:!previous.has(songId);
    if(previous.has(songId)!==add){
      if(list.specialType===5){const r=await mediaConnector.call('like_v1',{id:songId,like:add});if(r.code!==200)throw new Error('网易云未确认收藏成功');}
      else await mediaConnector.favorite(songId,target,add);
    }
    if(add){previous.add(songId);store.data.feedback[songId]={value:'like',at:Date.now(),song:currentSong(songId)};}else {previous.delete(songId);if(store.data.feedback[songId]?.value==='like')delete store.data.feedback[songId];}
    store.data.favorites[target]=[...previous];store.save();changed();return snapshot();
  }finally{favoritePending.delete(songId);}
}
function setupTray() {
  if (tray) { tray.destroy(); tray = null; }
  if (!store.data.settings.background&&!store.data.settings.floating) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  tray = new Tray(icon); tray.setToolTip('雷达');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开雷达', click: () => { win.show(); win.focus(); } }, { label: '退出', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}
async function automatic() {
  if (smoke || busy || !cookie || !store.data.settings.sourceConfirmed || !store.data.settings.analysisStarted || Date.now() < nextAttempt || (store.data.dailyUpdate?.status==='error'&&Date.now()<Date.parse(store.data.dailyUpdate.nextRetryAt))) return;
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const retry=dailyRetry(store.data);
  if (hour < store.data.settings.syncHour&&!retry) return;
  if(store.data.history.some(h=>h.date===dateKey())&&!retry){
    if(store.data.settings.deepAudio&&store.data.analysis.pending>0&&Date.now()>backgroundAnalysisAt){backgroundAnalysisAt=Date.now()+600000;try{await analyzeMore();}catch(e){progress(e.message);}}
    return;
  }
  nextAttempt = Date.now() + 300000;
  try {
    await generate();
    if (!win.isVisible() && Notification.isSupported()) new Notification({ title: '雷达', body: '今天的推荐歌单已准备好', icon: path.join(__dirname, 'icon.png') }).show();
  } catch (e) { progress(e.message); }
}
function createWindow() {
  win = new BrowserWindow({ width: 1180, height: 830, minWidth: 930, minHeight: 680, title: '雷达', backgroundColor: '#101716', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { if (!quitting && (store.data.settings.background||store.data.settings.floating) && tray) { event.preventDefault(); win.hide(); } });
  win.on('closed',()=>{if(!quitting){quitting=true;app.quit();}});
  win.loadFile(path.join(__dirname, 'index.html'));
  if (smoke) {
    const log = message => fs.appendFileSync(path.join(app.getPath('userData'), 'desktop-test.log'), message + '\n');
    win.webContents.on('render-process-gone', (_, details) => log('render-process-gone ' + JSON.stringify(details)));
    win.webContents.on('did-fail-load', (_, code, description) => log('did-fail-load ' + code + ' ' + description));
    win.webContents.on('console-message', (_, details) => log('renderer ' + details.message));
    setTimeout(() => { log('test timed out'); app.exit(1); }, process.argv.includes('--assistant-smoke')?180000:45000).unref();
    win.webContents.on('did-finish-load', async () => {
    try {
      log('did-finish-load');
      const result = await win.webContents.executeJavaScript('window.__smokeTest()');
      fs.writeFileSync(path.join(app.getPath('userData'), 'smoke.json'), JSON.stringify(result));
      const screenshot = await win.webContents.capturePage();
      fs.writeFileSync(path.join(app.getPath('userData'), 'smoke.png'), screenshot.toPNG());
      await win.webContents.executeJavaScript('window.__previewFixture(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const preview = await win.webContents.capturePage();
        fs.writeFileSync(path.join(app.getPath('userData'), 'preview.png'), preview.toPNG());
        await win.webContents.executeJavaScript('page("taste"); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await win.webContents.executeJavaScript('document.querySelector("#statistics-grid .avoid-details").open=true');
        await new Promise(r=>setTimeout(r,180));
        fs.writeFileSync(path.join(app.getPath('userData'),'statistics.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('page("settings"); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        await new Promise(r=>setTimeout(r,180));
        fs.writeFileSync(path.join(app.getPath('userData'),'settings.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('page("lyrics")');await new Promise(r=>setTimeout(r,180));
        fs.writeFileSync(path.join(app.getPath('userData'),'lyrics.png'),(await win.webContents.capturePage()).toPNG());
        for(const material of ['paper','neon','metal','aurora','ceramic','velvet','retro']){
          await win.webContents.executeJavaScript('appearanceDraft={mode:"dark",material:'+JSON.stringify(material)+',hue:275,saturation:60};renderAppearance();page("today")');await new Promise(r=>setTimeout(r,180));
          fs.writeFileSync(path.join(app.getPath('userData'),material+'.png'),(await win.webContents.capturePage()).toPNG());
        }
        await win.webContents.executeJavaScript('appearanceDraft={mode:"dark",material:"glass",hue:210,saturation:45};renderAppearance();page("today")');
        await new Promise(r=>setTimeout(r,180));
        fs.writeFileSync(path.join(app.getPath('userData'),'glass.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('appearanceDraft={mode:"light",material:"flat",hue:35,saturation:45};renderAppearance()');
        await new Promise(r=>setTimeout(r,180));
        fs.writeFileSync(path.join(app.getPath('userData'),'light.png'),(await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('appearanceDraft=null;renderAppearance()');
        await win.webContents.executeJavaScript('page("assistant")');await new Promise(r=>setTimeout(r,180));fs.writeFileSync(path.join(app.getPath('userData'),'assistant.png'),(await win.webContents.capturePage()).toPNG());
        if(process.argv.includes('--assistant-smoke')){
          const originalLibrary=store.data.library;store.data.library=Array.from({length:12},(_,i)=>({id:1000+i,name:'虚构验证样本',tags:['爵士','放松'],features:{language:'中文'}}));
          await win.webContents.executeJavaScript('appearanceDraft={mode:"dark",material:"aurora",hue:210,saturation:45};renderAppearance();page("assistant");$("ai-question").value="请把每次推荐设置为30首，探索比例设置为40";$("ai-form").requestSubmit()');
          for(let i=0;i<480;i++){if(!assistant.busy&&assistant.messages.length)break;await new Promise(r=>setTimeout(r,250));}
          if(assistant.busy||assistant.pending?.patch.count!==30||store.data.settings.count!==20)throw new Error('真实 AI 界面建议验证失败：'+assistant.error);
          await new Promise(r=>setTimeout(r,180));fs.writeFileSync(path.join(app.getPath('userData'),'assistant-live.png'),(await win.webContents.capturePage()).toPNG());
          await win.webContents.executeJavaScript('document.querySelector("#ai-suggestions .primary").click()');await new Promise(r=>setTimeout(r,300));
          if(store.data.settings.count!==30||store.data.settings.exploration!==40||assistant.pending)throw new Error('AI 建议应用验证失败');
          fs.writeFileSync(path.join(app.getPath('userData'),'assistant-test.json'),JSON.stringify({ok:true,count:store.data.settings.count,exploration:store.data.settings.exploration,model:assistant.snapshot().model,answer:assistant.messages.at(-1).text}));
          assistant.clear();assistant.close();store.data.library=originalLibrary;store.data.settings.count=20;store.data.settings.exploration=30;store.save();
          await win.webContents.executeJavaScript('window.__previewFixture();page("today")');
        }
        const fixture=await win.webContents.executeJavaScript('JSON.parse(JSON.stringify(state))');
        store.data.settings.floating=true;setupBubble();
        await new Promise(resolve=>bubble.webContents.once('did-finish-load',resolve));
        const oldHistory=store.data.history,oldResolve=player.options.resolve,oldSend=player.options.send,oldLyricsResolve=lyricService.options.resolve;
        store.data.history=fixture.history;player.options.resolve=async id=>({url:'isolated-test',trial:false});player.options.send=()=>{};lyricService.options.resolve=async()=>({lrc:{lyric:'[00:00]第一句\n[00:40]同步歌词'}});
        const firstPlay=await bubble.webContents.executeJavaScript('(async()=>{document.getElementById("toggle").click();for(let i=0;i<4;i++)await new Promise(r=>requestAnimationFrame(r));const s=(await window.music.request("state")).data;return {id:s.player.song?.id,lyrics:s.lyrics.status};})()');
        if(firstPlay.id!==fixture.history[0].songs[0].id||firstPlay.lyrics!=='timed')throw new Error('气泡首次播放与歌词接入验证失败');
        fs.writeFileSync(path.join(app.getPath('userData'),'first-play.json'),JSON.stringify(firstPlay));
        player.stop();player.options.resolve=oldResolve;player.options.send=oldSend;lyricService.options.resolve=oldLyricsResolve;store.data.history=oldHistory;
        const originalHue=store.data.settings.appearance.hue;
        const skin=await bubble.webContents.executeJavaScript('(async()=>{const before=getComputedStyle(document.getElementById("bubble")).background;await window.music.request("appearancePreview",{mode:"dark",material:"metal",hue:275,saturation:60});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return {changed:before!==getComputedStyle(document.getElementById("bubble")).background,hue:getComputedStyle(document.documentElement).getPropertyValue("--hue").trim(),material:document.documentElement.dataset.material};})()');
        if(!skin.changed||skin.hue!=='275'||skin.material!=='metal'||store.data.settings.appearance.hue!==originalHue)throw new Error('悬浮播放器实时材质配色同步失败');
        fs.writeFileSync(path.join(app.getPath('userData'),'appearance-test.json'),JSON.stringify(skin));appearancePreview=null;
        fixture.settings.appearance={mode:'dark',material:'glass',hue:210,saturation:45};
        const area=screen.getPrimaryDisplay().workArea;
        const interactive=await bubble.webContents.executeJavaScript(`(async()=>{const before=(await window.music.request('state')).data.player.mode;document.getElementById('mode').click();await new Promise(r=>requestAnimationFrame(r));const after=(await window.music.request('state')).data.player.mode;await window.music.request('floatingDrag',{phase:'start',x:${area.x+400},y:${area.y+5}});await window.music.request('floatingDrag',{phase:'end',x:${area.x+400},y:${area.y+300}});await window.music.request('bubbleExpand',{expanded:true});const s=(await window.music.request('state')).data;return {controls:before!==after,bubble:s.floating.mode==='bubble'&&s.floating.expanded,region:getComputedStyle(document.getElementById('bubble')).getPropertyValue('-webkit-app-region')};})()`);
        if(!interactive.controls||!interactive.bubble||interactive.region!=='no-drag')throw new Error('悬浮播放器交互验证失败');
        fs.writeFileSync(path.join(app.getPath('userData'),'floating-test.json'),JSON.stringify(interactive));
        fixture.floating={mode:'bubble',expanded:true};bubble.setBounds({x:100,y:100,width:420,height:370});
        await bubble.webContents.executeJavaScript('window.__previewFixture('+JSON.stringify(fixture)+'); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(app.getPath('userData'),'bubble.png'),(await bubble.webContents.capturePage()).toPNG());
        await bubble.webContents.executeJavaScript('window.music.request("floatingDock")');
        fixture.floating={mode:'dock',expanded:false};await bubble.webContents.executeJavaScript('window.__previewFixture('+JSON.stringify(fixture)+'); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(app.getPath('userData'),'dock.png'),(await bubble.webContents.capturePage()).toPNG());
        if(process.argv.includes('--model-smoke')){
          const rate=16000,samples=rate*10,bytes=Buffer.alloc(44+samples*2);
          bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVE',8);bytes.write('fmt ',12);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(rate,24);bytes.writeUInt32LE(rate*2,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
          for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*4000),44+i*2);
          const clips=await audioAnalysis.options.decode(bytes),features=await audioAnalysis.classify(clips);
          fs.writeFileSync(path.join(app.getPath('userData'),'model-test.json'),JSON.stringify({ok:Math.abs(features.brightness-440)<80,features,clips:clips.length}));
          if(Math.abs(features.brightness-440)>=80)throw new Error('模型验证失败');
        }
        if(process.argv.includes('--media-smoke')){
          await player.play([{id:33937527,name:'公开音源播放验证',artists:[]}],33937527);
          await new Promise(resolve=>setTimeout(resolve,4000));
          const playing=player.snapshot();fs.writeFileSync(path.join(app.getPath('userData'),'media-test.json'),JSON.stringify({...playing,queue:undefined}));
          if(playing.error||playing.time<=0)throw new Error('公开音源未开始播放');
          await player.command('toggle');await new Promise(resolve=>setTimeout(resolve,200));await player.command('seek',10);await player.command('toggle');
          await new Promise(resolve=>setTimeout(resolve,1000));
          if(player.snapshot().time<9||player.snapshot().paused)throw new Error('暂停或拖动进度验证失败');
          const real=await audioAnalysis.analyze({id:33937527,features:{}});
          fs.writeFileSync(path.join(app.getPath('userData'),'real-audio-test.json'),JSON.stringify(real.features.audio));
        }
        quitting = true; app.exit(result.ok ? 0 : 1);
    } catch (e) { log('test failed ' + e.message); app.exit(1); }
    });
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    readCookie();archiveSongs(store.data,store.data.library);for(const h of store.data.history)recordSeen(store.data,h.songs,h.createdAt||h.date+'T12:00:00+08:00');store.save(); connector = new Connector(() => cookie, progress);
    mediaConnector=new Connector(()=>cookie,()=>{});
    try{connector.cache=new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'lyric-cache.json'),'utf8'))).map(([id,value])=>[Number(id),value]));}catch{}
    const originalEnrich=connector.enrich.bind(connector);let cacheSavedAt=0;
    connector.enrich=async song=>{const enriched=await originalEnrich(song);if(Date.now()-cacheSavedAt>30000){fs.writeFileSync(path.join(app.getPath('userData'),'lyric-cache.json'),JSON.stringify(Object.fromEntries(connector.cache)));cacheSavedAt=Date.now();}return enriched;};
    const audioHelper=helperWindow('player.html','player-preload.js');playerWindow=audioHelper.window;
    const decoderHelper=helperWindow('decode.html','decode-preload.js');decodeWindow=decoderHelper.window;
    audioAnalysis=new AudioAnalysis({dataPath:app.getPath('userData'),modelPath:app.isPackaged?path.join(process.resourcesPath,'models','ast'):path.join(__dirname,'..','models','ast'),connector,progress,fetchAudio,onAnalyzed:song=>{if(song.analysisRole==='source'){archiveSongs(store.data,[song]);store.save();}},decode:async bytes=>{
      await decoderHelper.ready;const id=++decodeSequence;
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{decodePending.delete(id);reject(new Error('音频解码超时'));},20000);decodePending.set(id,{resolve,reject,timer});decodeWindow.webContents.send('audio:decode',{id,bytes});});
    }});
    lyricService=new LyricsController({resolve:id=>mediaConnector.call('lyric',{id}),changed:value=>{for(const w of uiWindows())w.webContents.send('music:lyrics',value);}});
    player=new PlayerController({resolve:id=>mediaConnector.playback(id),send:command=>audioHelper.ready.then(()=>playerWindow.webContents.send('player:command',command)),changed:value=>{lyricService.select(value.song?.id||null);for(const w of uiWindows())w.webContents.send('music:player',value);}});
    ipcMain.on('audio:decoded',(event,value)=>{if(event.sender!==decodeWindow.webContents)return;const p=decodePending.get(value.id);if(!p)return;clearTimeout(p.timer);decodePending.delete(value.id);value.error?p.reject(new Error(value.error)):p.resolve(value.clips);});
    ipcMain.on('player:report',(event,value)=>{if(event.sender===playerWindow.webContents)player.report(value).catch(e=>progress(e.message));});
    assistant=new Assistant({dataPath:app.getPath('userData'),runtimePath:app.isPackaged?path.join(process.resourcesPath,'runtime','llama'):path.join(__dirname,'..','runtime','llama'),data:()=>store.data,changed:value=>{if(win&&!win.isDestroyed())win.webContents.send('music:assistant',value);}});
    updates=configureUpdates({app,settings:()=>store.data.settings,disabled:smoke,notify:value=>{for(const w of uiWindows())w.webContents.send('music:update',value);}});
    ipcMain.handle('music:request', async (event, action, payload) => {
      if (!uiWindows().some(w=>w.webContents===event.sender) || event.senderFrame!==event.sender.mainFrame || !event.senderFrame.url.startsWith('file:')) return { ok: false, error: '请求来源无效' };
      try {
        let value;
        switch (action) {
          case 'state': value = snapshot(); break;
          case 'assistantInstall': value=await assistant.install();break;
          case 'assistantAsk': value=await assistant.ask(payload?.text);break;
          case 'assistantCancel': value=assistant.cancel();break;
          case 'assistantClear': value=assistant.clear();break;
          case 'assistantRemove': value=assistant.remove();break;
          case 'assistantDismiss': value=assistant.dismiss();break;
          case 'assistantApply': {
            if(busy)throw new Error('请等待推荐更新完成后应用建议');
            Object.assign(store.data.settings,assistant.apply(payload?.id));store.save();changed();value=snapshot();break;
          }
          case 'qr': {
            if (busy) throw new Error('请先等待更新完成');
            if(favoritePending.size)throw new Error('正在同步收藏，请稍后连接');
            const generation = ++qrGeneration; qrKey = ''; value = await connector.qr();
            if (generation !== qrGeneration) throw new Error('二维码请求已取消');
            qrKey = value.key; value = { image: value.image }; break;
          }
          case 'qrCheck': {
            if (!qrKey || qrBusy) { value = { code: 801 }; break; }
            qrBusy = true;
            try {
              const expectedKey = qrKey, expectedGeneration = qrGeneration;
              const r = await connector.call('login_qr_check', { key: expectedKey, noCookie: true }, true);
              if (qrKey !== expectedKey || qrGeneration !== expectedGeneration) { value = { code: 800 }; break; }
              value = { code: r.code };
              if (r.code === 803 && r.cookie) {
                // Establish identity before committing credentials, and keep account data isolated.
                const oldCookie = cookie; cookie = r.cookie;
                let profile;
                try { profile = await connector.account(); } finally { cookie = oldCookie; }
                if (qrKey !== expectedKey || qrGeneration !== expectedGeneration) { value = { code: 800 }; break; }
                const switchAccount = store.data.profile && store.data.profile.id !== profile.id;
                saveCookie(r.cookie);
                if (switchAccount) { assistant.clear(); const settings = { ...store.data.settings, selected: [] }; store.clear(); store.data.settings = settings; candidateCache = []; connector.cache.clear(); }
                store.data.profile = profile; store.save(); qrKey = ''; changed();
                store.data.settings.sourceConfirmed=false;store.data.settings.analysisStarted=false;store.save();changed();
              }
            } finally { qrBusy = false; }
            break;
          }
          case 'playlists': if (busy) throw new Error('请等待更新完成'); value=await loadPlaylists(); break;
          case 'generate': value = await generate(true); break;
          case 'appearancePreview': {appearancePreview=appearance.validate(payload||{});for(const w of uiWindows())w.webContents.send('music:appearance',appearancePreview);value=true;break;}
          case 'recommendationCount': {if(busy)throw new Error('请等待更新完成后调整数量');store.data.settings.count=recommendationSettings.count(payload?.count);store.save();changed();value=snapshot();break;}
          case 'lyricsRetry': {if(!player.snapshot().song)throw new Error('先播放一首歌曲');await lyricService.select(player.snapshot().song.id,true);value=lyricService.snapshot();break;}
          case 'appearance': {appearancePreview=null;store.data.settings.appearance=appearance.validate(payload||{});store.save();changed();value=snapshot();break;}
          case 'avoidance': {if(busy)throw new Error('更新中请稍后保存筛选');Object.assign(store.data.settings,validateAvoidance(payload||{}));store.save();changed();value=snapshot();break;}
          case 'analyzeMore': value=await analyzeMore();break;
          case 'cancel': connector.cancelled=true;value=true;break;
          case 'settings': {
            if (busy) throw new Error('更新中暂时无法修改设置');
            const p = payload || {};
            const count = Number(p.count), exploration = Number(p.exploration), syncHour = Number(p.syncHour);
            if (!Number.isInteger(count) || count<1 || count>100 || !Number.isInteger(exploration) || exploration < 0 || exploration > 60 || !Number.isInteger(syncHour) || syncHour < 0 || syncHour > 23) throw new Error('设置值无效');
            const selected = [...new Set((p.selected || []).map(id))];
            if (selected.length > 100 || selected.some(x => !store.data.playlists.some(y => y.id === x))) throw new Error('请选择可用的分析歌单');
            const target=p.favoritePlaylist? id(p.favoritePlaylist):null;
            if(target&&!store.data.playlists.some(y=>y.id===target&&y.ownerId===store.data.profile?.id))throw new Error('收藏目标需要是你自己的歌单');
            if(p.confirmSources&&(!selected.length||!target))throw new Error('请选择分析歌单和收藏目标');
            const audioBatch=Number(p.audioBatch??store.data.settings.audioBatch),repeatDays=Number(p.repeatDays??store.data.settings.repeatDays),artistLimit=Number(p.artistLimit??store.data.settings.artistLimit),albumLimit=Number(p.albumLimit??store.data.settings.albumLimit);
            if(![12,24,48,72].includes(audioBatch)||![7,14,30,60].includes(repeatDays)||![1,2,3].includes(artistLimit)||![1,2,3].includes(albumLimit))throw new Error('分析与去重设置无效');
            const weights=p.weights||store.data.settings.weights||{};const allowedWeights=Object.keys(require('./engine').WEIGHTS).filter(k=>k!=='artist');if(Object.entries(weights).some(([k,v])=>!allowedWeights.includes(k)||!Number.isFinite(v)||v<0||v>100)||Object.keys(weights).length&&allowedWeights.every(k=>(weights[k]??require('./engine').WEIGHTS[k]*100)===0))throw new Error('请至少保留一项推荐依据');
            const sourcesChanged=JSON.stringify(selected)!==JSON.stringify(store.data.settings.selected)||!!p.includeLikes!==store.data.settings.includeLikes||!!p.includeRecent!==store.data.settings.includeRecent;
            if(sourcesChanged)store.data.settings.analysisStarted=false;
            store.data.settings = {...store.data.settings,count, exploration, syncHour, selected, favoritePlaylist:target,sourceConfirmed:p.confirmSources?true:store.data.settings.sourceConfirmed,includeLikes:!!p.includeLikes,includeRecent:!!p.includeRecent,avoidKnownArtists:p.avoidKnownArtists!==false,floating:!!p.floating,deepAudio:p.deepAudio!==false,autoUpdate:p.autoUpdate!==false,audioBatch,repeatDays,artistLimit,albumLimit,weights,background: !!p.background, startup: !!p.startup };
            if(!smoke)app.setLoginItemSettings({ openAtLogin: !!p.startup }); store.save(); setupTray();setupBubble(); value = snapshot(); break;
          }
          case 'favorite': value=await favoriteSong(id(payload?.id),payload?.add);break;
          case 'playerPlay': {
            const songId=id(payload?.id);const history=store.data.history.find(h=>h.date===payload?.date)||store.data.history.find(h=>h.songs.some(s=>s.id===songId));
            if(!history)throw new Error('播放列表不存在');await player.play(history.songs,songId);value=player.snapshot();break;
          }
          case 'playerCommand': await recommendationSettings.playerCommand(player,store.data,payload?.type,payload?.value);value=player.snapshot();break;
          case 'openWindow':win.show();win.focus();value=true;break;
          case 'bubbleExpand': {
            if(event.sender!==bubble?.webContents)throw new Error('操作来源无效');
            if(store.data.settings.floatingMode!=='dock'){const bounds=bubble.getBounds();floatingExpanded=!!payload?.expanded;bubble.setBounds(expandBounds(bounds,floatingExpanded,screen.getDisplayMatching(bounds).workArea));notifyFloating();}value=true;break;
          }
          case 'floatingDrag': {
            if(event.sender!==bubble?.webContents)throw new Error('操作来源无效');
            const x=Number(payload?.x),y=Number(payload?.y);if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>100000||Math.abs(y)>100000)throw new Error('拖动位置无效');
            if(payload.phase==='start')floatingDrag={x,y,bounds:bubble.getBounds()};
            else if(payload.phase==='move'&&floatingDrag){const b=floatingDrag.bounds;bubble.setBounds({...b,x:Math.round(b.x+x-floatingDrag.x),y:Math.round(b.y+y-floatingDrag.y)});}
            else if(payload.phase==='end'&&floatingDrag){const area=screen.getDisplayNearestPoint({x:Math.round(x),y:Math.round(y)}).workArea;store.data.settings.floatingMode=y<=area.y+22?'dock':'bubble';floatingExpanded=false;const b=store.data.settings.floatingMode==='dock'?dockBounds(area):bubbleBounds(x,y,area);bubble.setBounds(b);store.data.settings.floatingPosition={x:b.x+b.width/2,y:b.y+b.height/2};floatingDrag=null;store.save();notifyFloating();}value=true;break;
          }
          case 'floatingDock': {
            const area=screen.getDisplayMatching(bubble?.getBounds()||win.getBounds()).workArea;store.data.settings.floatingMode='dock';floatingExpanded=false;bubble?.setBounds(dockBounds(area));store.save();notifyFloating();value=true;break;
          }
          case 'exportStatistics': {
            const target=await dialog.showSaveDialog(win,{title:'导出音乐偏好统计',defaultPath:'雷达-音乐偏好统计.json',filters:[{name:'统计数据',extensions:['json']}]});if(!target.canceled)fs.writeFileSync(target.filePath,JSON.stringify(statistics(store.data),null,2));value=!target.canceled;break;
          }
          case 'checkUpdate':value=await updates.check();break;
          case 'downloadUpdate':value=await updates.download();break;
          case 'installUpdate':if(updates.snapshot().status!=='ready')throw new Error('更新尚未下载完成');quitting=true;updates.install();value=true;break;
          case 'feedback': {
            const songId = id(payload?.id), valueType = payload?.value;
            if (!['like', 'dislike', 'none'].includes(valueType)) throw new Error('反馈值无效');
            const song = currentSong(songId); if (!song) throw new Error('歌曲不存在');
            if (valueType === 'none') delete store.data.feedback[songId];
            else store.data.feedback[songId] = { value: valueType, at: Date.now(), song };
            store.save(); value = snapshot(); break;
          }
          case 'block': {
            const song = currentSong(id(payload?.id)); if (!song) throw new Error('歌曲不存在');
            store.data.blockedArtists = [...new Set([...store.data.blockedArtists, ...song.artists.map(a => a.id).filter(Boolean)])]; store.save(); value = snapshot(); break;
          }
          case 'unblock': store.data.blockedArtists = []; store.save(); value = snapshot(); break;
          case 'replace': {
            if (busy) throw new Error('请先等待更新完成');
            const songId = id(payload?.id), today = store.data.history.find(h => h.date === dateKey());
            if (!today?.songs.some(s => s.id === songId)) throw new Error('只能替换今日歌单中的歌曲');
            if (!candidateCache.length) throw new Error('请先点击“更新今日歌单”获取候选，再替换歌曲');
            const picked = recommend(candidateCache, { ...store.data, settings: { ...store.data.settings, count: 1 } }, dateKey(), today.songs.map(s => s.id), today.songs.filter(s => s.id !== songId));
            if (!picked.length) throw new Error('暂时没有更多符合条件的候选');
            recordSeen(store.data,picked);today.songs = today.songs.map(s => s.id === songId ? picked[0] : s); store.save(); value = snapshot(); break;
          }
          case 'openSong': await shell.openExternal('https://music.163.com/#/song?id=' + id(payload?.id)); value = true; break;
          case 'export': {
            const history = store.data.history.find(h => h.date === payload?.date); if (!history) throw new Error('歌单不存在');
            const target = await dialog.showSaveDialog(win, { title: '导出歌单', defaultPath: `我可能喜欢-${history.date}.txt`, filters: [{ name: '文本歌单', extensions: ['txt'] }] });
            if (!target.canceled) fs.writeFileSync(target.filePath, history.songs.map(s => `${s.name} — ${s.artists.map(a => a.name).join(' / ')}\r\nhttps://music.163.com/#/song?id=${s.id}`).join('\r\n\r\n'), 'utf8');
            value = !target.canceled; break;
          }
          case 'logout': if (busy||favoritePending.size) throw new Error('请等待当前操作完成后退出');player.stop();lyricService.clear();assistant.clear(); cookie = ''; qrKey = ''; qrGeneration++; if (fs.existsSync(credentialPath())) fs.unlinkSync(credentialPath()); value = snapshot(); break;
          case 'clear': {
            if (busy||favoritePending.size) throw new Error('请等待当前操作完成后清除');
            const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['取消', '清除'], defaultId: 0, cancelId: 0, title: '清除本地数据', message: '清除账号连接、历史歌单和反馈？', detail: '网易云账号里的歌曲和歌单不会受影响。' });
            if (answer.response === 1) {player.stop();lyricService.clear();assistant.clear(); cookie = ''; qrKey = ''; qrGeneration++; if (fs.existsSync(credentialPath())) fs.unlinkSync(credentialPath()); if(!smoke)app.setLoginItemSettings({ openAtLogin: false }); store.clear(); candidateCache = []; connector.cache.clear();audioAnalysis.clear();fs.writeFileSync(path.join(app.getPath('userData'),'lyric-cache.json'),'{}');setupTray();setupBubble(); }
            value = snapshot(); break;
          }
          default: throw new Error('不支持的操作');
        }
        return { ok: true, data: value };
      } catch (error) { return { ok: false, error: error.message || '操作暂未完成，请重试' }; }
    });
    createWindow(); setupTray();setupBubble();
    setTimeout(automatic, 15000); setInterval(()=>{changed();automatic();},60000).unref();
    powerMonitor.on('resume',()=>{changed();automatic();});win.on('show',()=>{changed();automatic();});
    if(!smoke){setTimeout(()=>{if(store.data.settings.autoUpdate)updates.check();},120000);setInterval(()=>{if(store.data.settings.autoUpdate)updates.check();},14400000).unref();}
  });
  app.on('before-quit', () => { quitting = true;assistant?.close();audioAnalysis?.close();playerWindow?.destroy();decodeWindow?.destroy();bubble?.destroy(); });
  app.on('window-all-closed', () => app.quit());
}
