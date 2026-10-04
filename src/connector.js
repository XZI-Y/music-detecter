'use strict';
const { normalize, lexicalFeatures, hash, taste, dateKey } = require('./engine');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let keyInitialization;
function lazyApi(){
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
  const root=path.dirname(require.resolve('@neteasecloudmusicapienhanced/api'));
  if(!global.deviceId)global.deviceId=require(path.join(root,'util')).generateDeviceId();
  const token=path.join(os.tmpdir(),'anonymous_token');if(!fs.existsSync(token))fs.writeFileSync(token,'');
  async function prepareKey(){
    if(!keyInitialization)keyInitialization=(async()=>{
      const file=path.join(os.tmpdir(),'xeapi_public_key');let current={};try{current=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
      try{const value=await require(path.join(root,'util','xeapiKey')).getXeapiPublicKey(current,global.deviceId||'');fs.writeFileSync(file,JSON.stringify(value));}
      catch(error){if(!current.publicKey){keyInitialization=null;throw error;}}
    })();
    await keyInitialization;
  }
  return new Proxy({}, {get(target,name){
    if(typeof name!=='string'||!/^[a-z0-9_]+$/.test(name))return undefined;
    if(target[name])return target[name];
    const modulePath=path.join(root,'module',name+'.js');if(!fs.existsSync(modulePath))return undefined;
    const needsKey=fs.readFileSync(modulePath,'utf8').includes("'xeapi'");
    return target[name]=async(data={})=>{if(needsKey&&(!data.crypto||data.crypto==='xeapi'))await prepareKey();const {cookieToJson}=require(path.join(root,'util'));return require(modulePath)({...data,cookie:typeof data.cookie==='string'?cookieToJson(data.cookie):data.cookie||{}},require(path.join(root,'util','request')));};
  }});
}
class Connector {
  constructor(getCookie, progress) { this.getCookie = getCookie; this.progress = progress; this.api = lazyApi(); this.cache = new Map(); this.cancelled = false; }
  async call(name, params = {}, anonymous = false) {
    if (this.cancelled) throw new Error('操作已取消');
    const method = this.api[name];
    if (typeof method !== 'function') throw new Error('当前接口版本不支持此功能：' + name);
    let timer;
    try {
      const result = await Promise.race([method({ ...params, cookie: anonymous ? '' : this.getCookie(), timestamp: Date.now(), timeout: 12000 }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('连接超时，请检查网络后重试')), 16000); })]);
      let body = result.body || result;
      for (let i = 0; i < 3 && body.body && typeof body.body === 'object'; i++) body = body.body;
      if (body.code && body.code !== 200 && ![800, 801, 802, 803].includes(body.code)) {
        if ([301, 302].includes(body.code)) throw new Error('登录已失效，请重新扫码连接');
        throw new Error('网易云暂时未提供此数据（' + body.code + '）');
      }
      await delay(150);
      return body;
    } catch (e) {
      // Do not surface third-party errors containing cookies, request headers, or personal details.
      if (/^(连接超时|登录已失效|网易云暂时|操作已取消|当前接口)/.test(e.message || '')) throw e;
      const code = e.body?.code || e.status || e.code;
      if (Number(code) === 301) throw new Error('登录已失效，请重新扫码连接');
      throw new Error('暂时无法连接网易云，请检查网络或稍后重试' + (Number.isInteger(Number(code)) ? '（' + code + '）' : ''));
    } finally { clearTimeout(timer); }
  }
  async qr() {
    const keyResult = await this.call('login_qr_key', {}, true);
    const key = keyResult.data?.unikey;
    if (!key) throw new Error('无法生成登录二维码，请稍后重试');
    const result = await this.call('login_qr_create', { key, qrimg: true }, true);
    return { key, image: result.data?.qrimg };
  }
  async account() {
    const result = await this.call('user_account');
    const p = result.profile;
    if (!p?.userId) throw new Error('登录已失效，请重新扫码连接');
    return { id: Number(p.userId), name: p.nickname || '网易云用户' };
  }
  async playlists(uid) {
    const lists = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await this.call('user_playlist', { uid, offset, limit: 100 });
      lists.push(...(r.playlist || []));
      if (!r.more || !r.playlist?.length) break;
    }
    return lists.map(p => ({ id: Number(p.id), name: p.name, count: p.trackCount, tags: p.tags || [], ownerId: Number(p.creator?.userId),specialType:p.specialType||0 }));
  }
  async details(ids) {
    const result = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const r = await this.call('song_detail', { ids: ids.slice(offset, offset + 100).join(',') });
      const privileges = new Map((r.privileges || []).map(p => [p.id, p]));
      result.push(...(r.songs || []).map(s => normalize({ ...s, privilege: privileges.get(s.id) })));
    }
    return result;
  }
  async playlist(id, limit = 200) {
    const result = await this.call('playlist_detail', { id });
    const p = result.playlist;
    if (!p) throw new Error('该歌单暂时无法读取');
    const ids = (p.trackIds || []).slice(0, limit).map(t => t.id);
    let songs = (p.tracks || []).slice(0, limit).map(s => normalize(s, p.tags || []));
    if (ids.length > songs.length) songs = (await this.details(ids)).map(s => ({ ...s, tags: p.tags || [] }));
    return { songs, total: p.trackCount || ids.length, tags: p.tags || [] };
  }
  async playback(id) {
    const result = await this.call('song_url_v1', { id, level: 'standard', unblock: 'false' });
    const item = result.data?.find(s => Number(s.id) === Number(id));
    if (!item?.url) throw new Error('这首歌暂时无法播放，请确认账号权限或换一首');
    const url = new URL(item.url);
    if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)(music\.126\.net|music\.163\.com|126\.net|163\.com)$/.test(url.hostname)) throw new Error('网易云返回的播放地址无效');
    url.protocol = 'https:';
    return { url: url.href, trial: !!item.freeTrialInfo, expires: Date.now() + (item.expi || 600) * 1000 };
  }
  async favorite(songId, playlistId, add = true) {
    const result = await this.call('playlist_tracks', { op: add ? 'add' : 'del', pid: playlistId, tracks: String(songId) });
    if (result.code !== 200) throw new Error('网易云未确认收藏成功，请重试');
    return true;
  }
  async fullPlaylist(playlistId, previous = []) {
    const result = await this.call('playlist_detail', { id: playlistId });
    const p = result.playlist;
    if (!p || !Array.isArray(p.trackIds)) throw new Error('该歌单暂时无法完整读取');
    const ids = p.trackIds.map(t => Number(t.id)), byId = new Map(previous.map(s => [s.id, s]));
    for (const s of p.tracks || []) if (!byId.has(Number(s.id))) byId.set(Number(s.id), normalize(s));
    const missing = ids.filter(id => !byId.has(id));
    const fetched = await this.details(missing);
    for (const s of fetched) byId.set(s.id, s);
    if (ids.some(id => !byId.has(id))) throw new Error('歌单中有歌曲资料未能读取，请稍后重试');
    return { songs: ids.map(id => ({ ...byId.get(id), tags:p.tags||[] })), total: ids.length, tags: p.tags || [] };
  }
  async enrich(song) {
    const cached = this.cache.get(song.id);
    if (cached) return { ...song, features:{...song.features,...cached} };
    try {
      const r = await this.call('lyric', { id: song.id });
      const features = {...lexicalFeatures(r.lrc?.lyric || ''),lyricAnalyzed:true};
      this.cache.set(song.id, features);
      return { ...song, features:{...song.features,...features} };
    } catch { return song; }
  }
  async sync(data) {
    if (!data.settings.sourceConfirmed || !data.settings.selected.length) throw new Error('请先选择分析歌单并点击“保存选择”');
    this.progress('正在读取你的音乐资料…');
    const profile = await this.account();
    const likeResult = await this.call('likelist', { uid: profile.id });
    if (!Array.isArray(likeResult.ids)) throw new Error('喜欢列表未返回有效数据，原有资料已保留');
    const likedIds = likeResult.ids.map(Number);
    const warnings = [];
    const playlists = await this.playlists(profile.id);
    let library = [];
    if (data.settings.includeLikes) {
      const previous = new Map(data.library.map(s => [s.id, s]));
      const fetched = await this.details(likedIds.filter(id => !previous.has(id)));
      for (const s of fetched) previous.set(s.id, s);
      library = likedIds.filter(id => previous.has(id)).map(id => ({ ...previous.get(id), liked: true }));
    }
    const selected = data.settings.selected;
    for (let i = 0; i < selected.length; i++) {
      this.progress(`正在分析选定歌单 ${i + 1}/${selected.length}…`);
      try {
        const p = await this.fullPlaylist(selected[i], data.library);
        library.push(...p.songs);
      } catch (e) { throw new Error(`歌单“${playlists.find(x => x.id === selected[i])?.name || selected[i]}”未能完整读取。已有资料保留，请重试。`); }
    }
    this.progress('正在读取可获取的近期听歌排行…');
    if (data.settings.includeRecent) try {
      const r = await this.call('user_record', { uid: profile.id, type: 1 });
      if (Array.isArray(r.weekData) && r.weekData.length) library.push(...r.weekData.slice(0, 60).map(x => ({ ...normalize(x.song), recent: true })));
      else warnings.push('未获取到近期听歌排行；继续使用喜欢列表和指定歌单。');
    } catch { warnings.push('近期听歌排行暂不可用；继续使用喜欢列表和指定歌单。'); }
    const byId = new Map();
    for (const song of library) {
      const old = byId.get(song.id);
      byId.set(song.id, old ? { ...old, liked: old.liked || song.liked, recent: old.recent || song.recent, tags: [...new Set([...old.tags, ...song.tags])] } : song);
    }
    for (const [id, fb] of Object.entries(data.feedback)) if (fb.value === 'like' && fb.song) byId.set(Number(id), { ...fb.song, localLiked: true });
    library = [...byId.values()];
    if (!library.length) throw new Error('还没有可用于分析的歌曲。请先在网易云喜欢一些歌曲，或选择一个歌单。');
    return { profile, likedIds, playlists, library, warnings, lastSync: new Date().toISOString() };
  }
  async candidates(data) {
    const pool = new Map(), warnings = [...data.warnings];
    const usable = data.library.filter(s => data.feedback[s.id]?.value !== 'dislike' && !s.artists.some(a => data.blockedArtists.includes(a.id)));
    const seedOrder = [...usable].sort((a, b) => {
      const priority = s => (data.feedback[s.id]?.value === 'like' ? 2 : 0) + (s.recent ? 1 : 0);
      return priority(b) - priority(a) || hash(dateKey() + a.id) - hash(dateKey() + b.id);
    });
    // Reserve seeds for the different observed playlist tags, then fill from recent and long-term taste.
    const selected = [], seen = new Set();
    for (const { tag } of taste(usable).slice(0, 5)) {
      const seed = seedOrder.find(s => s.tags.includes(tag) && !seen.has(s.id));
      if (seed) { selected.push(seed); seen.add(seed.id); }
    }
    for (const seed of seedOrder) if (!seen.has(seed.id) && selected.length < 40) { selected.push(seed); seen.add(seed.id); }
    const add = (s, source) => {
      const old = pool.get(s.id);
      if (old) { old.sources.push(source); old.tags = [...new Set([...old.tags, ...s.tags])]; }
      else pool.set(s.id, { ...s, sources: [source] });
    };
    let failed = 0;
    for (let i = 0; i < selected.length; i++) {
      this.progress(`寻找相似歌曲 ${i + 1}/${selected.length}…`);
      const seed = selected[i];
      try {
        const r = await this.call('simi_song', { id: seed.id });
        for (const s of r.songs || []) add(normalize(s), { type: 'similar', seedId: seed.id });
      } catch { failed++; }
      if (i < 10) try {
        const r = await this.call('simi_playlist', { id: seed.id });
        for (const list of (r.playlists || []).slice(0, 2)) {
          try {
            const p = await this.playlist(list.id, 40);
            if (!seed.tags.length) seed.tags = p.tags;
            for (const s of p.songs) add(s, { type: 'playlist', seedId: seed.id });
          } catch { /* retain other candidate channels */ }
        }
      } catch { /* optional channel */ }
    }
    if (failed) warnings.push(`${failed} 条歌曲关联暂不可用，已尝试其他来源。`);
    this.progress('补充相近风格和探索候选…');
    for (const { tag } of taste(usable).slice(0, 3)) try {
      const r = await this.call('top_playlist', { cat: tag, limit: 3 });
      const list = (r.playlists || [])[hash(dateKey() + tag) % (r.playlists?.length || 1)];
      if (list) for (const s of (await this.playlist(list.id, 40)).songs) add(s, { type: 'explore' });
    } catch { /* optional channel */ }
    try {
      const r = await this.call('recommend_songs');
      // Platform recommendations are a small candidate channel, never the whole result.
      for (const s of (r.data?.dailySongs || r.recommend || []).slice(0, 10)) add(normalize(s), { type: 'daily' });
    } catch { warnings.push('网易云每日推荐候选暂不可用。'); }
    if (!pool.size) throw new Error('未取得可用候选歌曲，请检查网络后重试。原有歌单已保留。');
    const known = new Set([...data.likedIds, ...data.library.map(s => s.id)]);
    let candidates = [...pool.values()].filter(s => !known.has(s.id));
    // Batch details add copyright flags, release dates and canonical metadata to the candidates.
    try {
      const enriched = await this.details(candidates.map(s => s.id));
      const map = new Map(enriched.map(s => [s.id, s]));
      candidates = candidates.map(s => ({ ...s, ...(map.get(s.id) || {}), tags: s.tags, sources: s.sources }));
    } catch { warnings.push('部分歌曲详情未能更新，播放可用性以网易云页面为准。'); }
    const lyricSeeds = selected;
    for (let i = 0; i < lyricSeeds.length; i++) {
      this.progress(`提取歌词线索 ${i + 1}/${lyricSeeds.length + Math.min(candidates.length, 160)}…`);
      const song = await this.enrich(lyricSeeds[i]);
      const existing = data.library.find(s => s.id === song.id);
      if (existing) { existing.features = song.features; existing.tags = song.tags; }
    }
    candidates.sort((a, b) => Number(b.sources.some(s => s.type === 'similar')) - Number(a.sources.some(s => s.type === 'similar')) || hash(dateKey() + a.id) - hash(dateKey() + b.id));
    for (let i = 0; i < Math.min(candidates.length, 160); i++) {
      this.progress(`提取歌词线索 ${lyricSeeds.length + i + 1}/${lyricSeeds.length + Math.min(candidates.length, 160)}…`);
      candidates[i] = await this.enrich(candidates[i]);
    }
    return { candidates, warnings };
  }
}
module.exports = { Connector };
