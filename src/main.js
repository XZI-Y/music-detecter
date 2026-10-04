'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, Tray, Menu, nativeImage, Notification, dialog, screen, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { Connector } = require('./connector');
const { recommend, taste, dateKey } = require('./engine');
const {AudioAnalysis}=require('./analysis');
const {PlayerController}=require('./player-controller');
const {configureUpdates}=require('./updater');
const originalLog = console.log;
console.log = (...args) => { if (args[0] === '[ERR]') originalLog('[网易云接口暂不可用]'); else originalLog(...args); };
app.setName('听见新喜欢');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let win, playerWindow, decodeWindow, bubble, player, audioAnalysis, updates, store, connector, mediaConnector, cookie = '', busy = false, quitting = false, tray, qrKey = '', qrBusy = false, qrGeneration = 0, candidateCache = [], nextAttempt = 0;
let decodeSequence=0,backgroundAnalysisAt=0;const decodePending=new Map(),favoritePending=new Set();
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
  return { ...d, library: undefined, likedIds: undefined, feedback: Object.fromEntries(Object.entries(d.feedback).map(([k, v]) => [k, { value: v.value }])), connected: !!cookie, libraryCount: d.library.length, likedCount: d.likedIds.length, taste: taste(d.library), busy, today: dateKey(), player:player?.snapshot(),update:updates?.snapshot(),version:app.getVersion() };
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
  busy = true; changed();
  connector.cancelled = false;
  try {
    const draft = structuredClone(store.data);
    const synced = await connector.sync(draft);
    Object.assign(draft, synced);
    const { candidates, warnings } = await connector.candidates(draft);
    draft.library=draft.library.map(s=>audioAnalysis.attach(s));
    let enrichedCandidates=candidates.map(s=>audioAnalysis.attach(s));
    if(draft.settings.deepAudio){
      const seedBatch=await audioAnalysis.batch(draft.library,Math.max(4,Math.floor(draft.settings.audioBatch/3)));
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
    draft.history = [{ date, createdAt: new Date().toISOString(), exploration:draft.settings.exploration,songs: finalSongs }, ...draft.history.filter(h => h.date !== date)].slice(0, 90);
    draft.warnings = [...new Set(warnings)];
    draft.analysis=analysisCounts(draft.library);
    store.data = draft; store.save(); candidateCache = enrichedCandidates;
    progress('今日歌单已更新');
    return snapshot();
  } finally { busy = false; changed(); }
}
function analysisCounts(library){return {metadata:library.length,lyrics:library.filter(s=>s.features?.language||s.features?.lyricAnalyzed).length,audio:library.filter(s=>s.features?.audio).length,pending:library.filter(s=>!s.features?.audio).length};}
async function analyzeMore(){
  if(busy)throw new Error('正在更新，请稍后再试');if(!store.data.settings.sourceConfirmed||!store.data.library.length)throw new Error('先选择歌单并完成首次分析');
  busy=true;connector.cancelled=false;changed();
  try{
    const songs=[];
    for(const song of store.data.library){if(connector.cancelled)throw new Error('操作已取消');songs.push(await connector.enrich(song));}
    const result=await audioAnalysis.batch(songs,store.data.settings.audioBatch);
    store.data.library=result.songs;store.data.analysis=analysisCounts(result.songs);store.save();progress(`已识别 ${store.data.analysis.audio} 首歌曲的音频特征`);return snapshot();
  }finally{busy=false;changed();}
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
  const area=screen.getPrimaryDisplay().workArea;
  bubble=new BrowserWindow({x:area.x+area.width-92,y:area.y+area.height-95,width:64,height:64,frame:false,transparent:true,resizable:false,alwaysOnTop:true,skipTaskbar:true,hasShadow:false,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  bubble.setAlwaysOnTop(true,'floating');bubble.webContents.setWindowOpenHandler(()=>({action:'deny'}));bubble.webContents.on('will-navigate',e=>e.preventDefault());bubble.loadFile(path.join(__dirname,'floating.html'));
  bubble.on('closed',()=>{bubble=null;});
}
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
  tray = new Tray(icon); tray.setToolTip('听见新喜欢');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开听见新喜欢', click: () => { win.show(); win.focus(); } }, { label: '退出', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}
async function automatic() {
  if (smoke || busy || !cookie || !store.data.settings.sourceConfirmed || !store.data.settings.analysisStarted || Date.now() < nextAttempt) return;
  const hour = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (hour < store.data.settings.syncHour) return;
  if(store.data.history.some(h=>h.date===dateKey())){
    if(store.data.settings.deepAudio&&store.data.analysis.pending>0&&Date.now()>backgroundAnalysisAt){backgroundAnalysisAt=Date.now()+600000;try{await analyzeMore();}catch(e){progress(e.message);}}
    return;
  }
  nextAttempt = Date.now() + 3600000;
  try {
    await generate();
    if (!win.isVisible() && Notification.isSupported()) new Notification({ title: '听见新喜欢', body: '今天的推荐歌单已准备好', icon: path.join(__dirname, 'icon.png') }).show();
  } catch (e) { progress(e.message); }
}
function createWindow() {
  win = new BrowserWindow({ width: 1180, height: 830, minWidth: 930, minHeight: 680, title: '听见新喜欢', backgroundColor: '#101716', icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
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
    setTimeout(() => { log('test timed out'); app.exit(1); }, 45000).unref();
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
        const fixture=await win.webContents.executeJavaScript('JSON.parse(JSON.stringify(state))');
        store.data.settings.floating=true;setupBubble();
        await new Promise(resolve=>bubble.webContents.once('did-finish-load',resolve));
        bubble.setBounds({x:100,y:100,width:420,height:345});
        await bubble.webContents.executeJavaScript('window.__previewFixture('+JSON.stringify(fixture)+'); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(path.join(app.getPath('userData'),'bubble.png'),(await bubble.webContents.capturePage()).toPNG());
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
    readCookie(); connector = new Connector(() => cookie, progress);
    mediaConnector=new Connector(()=>cookie,()=>{});
    try{connector.cache=new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'lyric-cache.json'),'utf8'))).map(([id,value])=>[Number(id),value]));}catch{}
    const originalEnrich=connector.enrich.bind(connector);let cacheSavedAt=0;
    connector.enrich=async song=>{const enriched=await originalEnrich(song);if(Date.now()-cacheSavedAt>30000){fs.writeFileSync(path.join(app.getPath('userData'),'lyric-cache.json'),JSON.stringify(Object.fromEntries(connector.cache)));cacheSavedAt=Date.now();}return enriched;};
    const audioHelper=helperWindow('player.html','player-preload.js');playerWindow=audioHelper.window;
    const decoderHelper=helperWindow('decode.html','decode-preload.js');decodeWindow=decoderHelper.window;
    audioAnalysis=new AudioAnalysis({dataPath:app.getPath('userData'),modelPath:app.isPackaged?path.join(process.resourcesPath,'models','ast'):path.join(__dirname,'..','models','ast'),connector,progress,fetchAudio,decode:async bytes=>{
      await decoderHelper.ready;const id=++decodeSequence;
      return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{decodePending.delete(id);reject(new Error('音频解码超时'));},20000);decodePending.set(id,{resolve,reject,timer});decodeWindow.webContents.send('audio:decode',{id,bytes});});
    }});
    player=new PlayerController({resolve:id=>mediaConnector.playback(id),send:command=>audioHelper.ready.then(()=>playerWindow.webContents.send('player:command',command)),changed:value=>{for(const w of uiWindows())w.webContents.send('music:player',value);}});
    ipcMain.on('audio:decoded',(event,value)=>{if(event.sender!==decodeWindow.webContents)return;const p=decodePending.get(value.id);if(!p)return;clearTimeout(p.timer);decodePending.delete(value.id);value.error?p.reject(new Error(value.error)):p.resolve(value.clips);});
    ipcMain.on('player:report',(event,value)=>{if(event.sender===playerWindow.webContents)player.report(value).catch(e=>progress(e.message));});
    updates=configureUpdates({app,settings:()=>store.data.settings,disabled:smoke,notify:value=>{for(const w of uiWindows())w.webContents.send('music:update',value);}});
    ipcMain.handle('music:request', async (event, action, payload) => {
      if (!uiWindows().some(w=>w.webContents===event.sender) || event.senderFrame!==event.sender.mainFrame || !event.senderFrame.url.startsWith('file:')) return { ok: false, error: '请求来源无效' };
      try {
        let value;
        switch (action) {
          case 'state': value = snapshot(); break;
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
                if (switchAccount) { const settings = { ...store.data.settings, selected: [] }; store.clear(); store.data.settings = settings; candidateCache = []; connector.cache.clear(); }
                store.data.profile = profile; store.save(); qrKey = ''; changed();
                store.data.settings.sourceConfirmed=false;store.data.settings.analysisStarted=false;store.save();changed();
              }
            } finally { qrBusy = false; }
            break;
          }
          case 'playlists': if (busy) throw new Error('请等待更新完成'); value=await loadPlaylists(); break;
          case 'generate': value = await generate(true); break;
          case 'analyzeMore': value=await analyzeMore();break;
          case 'cancel': connector.cancelled=true;value=true;break;
          case 'settings': {
            if (busy) throw new Error('更新中暂时无法修改设置');
            const p = payload || {};
            const count = Number(p.count), exploration = Number(p.exploration), syncHour = Number(p.syncHour);
            if (![10, 20, 30].includes(count) || !Number.isInteger(exploration) || exploration < 0 || exploration > 60 || !Number.isInteger(syncHour) || syncHour < 0 || syncHour > 23) throw new Error('设置值无效');
            const selected = [...new Set((p.selected || []).map(id))];
            if (selected.length > 100 || selected.some(x => !store.data.playlists.some(y => y.id === x))) throw new Error('请选择可用的分析歌单');
            const target=p.favoritePlaylist? id(p.favoritePlaylist):null;
            if(target&&!store.data.playlists.some(y=>y.id===target&&y.ownerId===store.data.profile?.id))throw new Error('收藏目标需要是你自己的歌单');
            if(p.confirmSources&&(!selected.length||!target))throw new Error('请选择分析歌单和收藏目标');
            const sourcesChanged=JSON.stringify(selected)!==JSON.stringify(store.data.settings.selected)||!!p.includeLikes!==store.data.settings.includeLikes||!!p.includeRecent!==store.data.settings.includeRecent;
            if(sourcesChanged)store.data.settings.analysisStarted=false;
            store.data.settings = {...store.data.settings,count, exploration, syncHour, selected, favoritePlaylist:target,sourceConfirmed:p.confirmSources?true:store.data.settings.sourceConfirmed,includeLikes:!!p.includeLikes,includeRecent:!!p.includeRecent,avoidKnownArtists:p.avoidKnownArtists!==false,floating:!!p.floating,deepAudio:p.deepAudio!==false,autoUpdate:p.autoUpdate!==false,background: !!p.background, startup: !!p.startup };
            if(!smoke)app.setLoginItemSettings({ openAtLogin: !!p.startup }); store.save(); setupTray();setupBubble(); value = snapshot(); break;
          }
          case 'favorite': value=await favoriteSong(id(payload?.id),payload?.add);break;
          case 'playerPlay': {
            const songId=id(payload?.id);const history=store.data.history.find(h=>h.date===payload?.date)||store.data.history.find(h=>h.songs.some(s=>s.id===songId));
            if(!history)throw new Error('播放列表不存在');await player.play(history.songs,songId);value=player.snapshot();break;
          }
          case 'playerCommand': await player.command(payload?.type,payload?.value);value=player.snapshot();break;
          case 'openWindow':win.show();win.focus();value=true;break;
          case 'bubbleExpand': {
            if(event.sender!==bubble?.webContents)throw new Error('操作来源无效');
            const bounds=bubble.getBounds(),area=screen.getDisplayMatching(bounds).workArea;const width=payload?.expanded?420:64,height=payload?.expanded?345:64;
            bubble.setBounds({x:Math.max(area.x,Math.min(bounds.x+bounds.width-width,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y+bounds.height-height,area.y+area.height-height)),width,height});value=true;break;
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
            today.songs = today.songs.map(s => s.id === songId ? picked[0] : s); store.save(); value = snapshot(); break;
          }
          case 'openSong': await shell.openExternal('https://music.163.com/#/song?id=' + id(payload?.id)); value = true; break;
          case 'export': {
            const history = store.data.history.find(h => h.date === payload?.date); if (!history) throw new Error('歌单不存在');
            const target = await dialog.showSaveDialog(win, { title: '导出歌单', defaultPath: `我可能喜欢-${history.date}.txt`, filters: [{ name: '文本歌单', extensions: ['txt'] }] });
            if (!target.canceled) fs.writeFileSync(target.filePath, history.songs.map(s => `${s.name} — ${s.artists.map(a => a.name).join(' / ')}\r\nhttps://music.163.com/#/song?id=${s.id}`).join('\r\n\r\n'), 'utf8');
            value = !target.canceled; break;
          }
          case 'logout': if (busy||favoritePending.size) throw new Error('请等待当前操作完成后退出');player.stop(); cookie = ''; qrKey = ''; qrGeneration++; if (fs.existsSync(credentialPath())) fs.unlinkSync(credentialPath()); value = snapshot(); break;
          case 'clear': {
            if (busy||favoritePending.size) throw new Error('请等待当前操作完成后清除');
            const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['取消', '清除'], defaultId: 0, cancelId: 0, title: '清除本地数据', message: '清除账号连接、历史歌单和反馈？', detail: '网易云账号里的歌曲和歌单不会受影响。' });
            if (answer.response === 1) {player.stop(); cookie = ''; qrKey = ''; qrGeneration++; if (fs.existsSync(credentialPath())) fs.unlinkSync(credentialPath()); if(!smoke)app.setLoginItemSettings({ openAtLogin: false }); store.clear(); candidateCache = []; connector.cache.clear();audioAnalysis.clear();fs.writeFileSync(path.join(app.getPath('userData'),'lyric-cache.json'),'{}');setupTray();setupBubble(); }
            value = snapshot(); break;
          }
          default: throw new Error('不支持的操作');
        }
        return { ok: true, data: value };
      } catch (error) { return { ok: false, error: error.message || '操作暂未完成，请重试' }; }
    });
    createWindow(); setupTray();setupBubble();
    setTimeout(automatic, 15000); setInterval(automatic, 60000).unref();
    if(!smoke){setTimeout(()=>{if(store.data.settings.autoUpdate)updates.check();},120000);setInterval(()=>{if(store.data.settings.autoUpdate)updates.check();},14400000).unref();}
  });
  app.on('before-quit', () => { quitting = true;audioAnalysis?.close();playerWindow?.destroy();decodeWindow?.destroy();bubble?.destroy(); });
  app.on('window-all-closed', () => app.quit());
}
