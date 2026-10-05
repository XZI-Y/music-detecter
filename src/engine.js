'use strict';
const {audioSimilarity}=require('./audio-features');
const WEIGHTS = { relation: .18, style: .13, mood: .05, theme: .05, language: .03, era: .02, duration: .02, feedback: .08, instruments: .20, rhythm: .08, timbre: .06, harmony: .04, dynamics: .03, vocal: .03, artist: 0 };
const vocabulary = {
  mood: { 温暖: ['温暖', '温柔', '拥抱', '阳光', 'warm', 'gentle'], 忧伤: ['眼泪', '难过', '孤独', '悲伤', '寂寞', 'lonely', 'tears'], 希望: ['希望', '梦想', '勇敢', '未来', 'hope', 'dream'], 思念: ['想念', '思念', '回忆', '怀念', 'miss you', 'memories'] },
  theme: { 爱情: ['爱情', '爱你', '恋人', 'love', 'lover'], 离别: ['再见', '离开', '告别', 'goodbye', 'farewell'], 自然: ['山川', '森林', '海洋', '星空', 'ocean', 'forest'], 成长: ['长大', '青春', '童年', '少年', 'young', 'childhood'], 城市: ['街道', '城市', '车站', 'city', 'street'] }
};
function lexicalFeatures(lyrics = '') {
  const text = lyrics.replace(/\[[^\]]*\]/g, '').replace(/^(作词|作曲|编曲|制作人|混音).*$/gm, '').toLowerCase();
  const result = { mood: [], theme: [], language: null };
  for (const type of ['mood', 'theme']) for (const [tag, words] of Object.entries(vocabulary[type])) {
    const matched = words.filter(w => text.includes(w));
    if (matched.length >= 2) result[type].push(tag);
  }
  if (text.trim().length > 40) {
    if (/[ぁ-ゖァ-ヺ]/.test(text)) result.language = '日语';
    else if (/[가-힣]/.test(text)) result.language = '韩语';
    else if ((text.match(/[\u4e00-\u9fff]/g) || []).length > 20) result.language = '中文';
    else if ((text.match(/[a-z]+/g) || []).length > 20) result.language = '英语';
  }
  return result;
}
function normalize(s, tags = []) {
  const album = s.al || s.album || {};
  return { id: Number(s.id), name: s.name || '未知歌曲', artists: (s.ar || s.artists || []).map(a => ({ id: Number(a.id), name: a.name || '未知歌手' })), album: album.name || '', albumId: Number(album.id) || 0, cover: (album.picUrl || '').replace(/^http:/, 'https:'), duration: Number(s.dt || s.duration) || 0, year: s.publishTime > 0 ? new Date(s.publishTime).getFullYear() : null, tags: [...new Set(tags)], features: { mood: [], theme: [], language: null }, sources: [], fee: s.fee || 0, unavailable: s.noCopyrightRcmd != null || s.privilege?.st < 0 };
}
function overlap(a = [], b = []) { if (!a.length || !b.length) return null; return a.filter(x => b.includes(x)).length / Math.min(a.length, b.length); }
function dateKey(now = new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
function hash(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function effectiveWeights(settings={}) {
 const result={...WEIGHTS};for(const key of Object.keys(result))if(key!=="artist"&&Number.isFinite(settings.weights?.[key]))result[key]=Math.max(0,Math.min(100,settings.weights[key]))/100;const sum=Object.values(result).reduce((a,b)=>a+b,0);return sum?Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v/sum])):WEIGHTS;
}
function rankSong(song, seeds, feedback = {}, settings = {}) {
 const weights=effectiveWeights(settings);
  let best = { score: 0, reasons: [], breakdown: {}, seedId: null };
  for (const seed of seeds) {
    const sameArtist = song.artists.some(a => a.id && seed.artists.some(b => a.id === b.id));
    const f = song.features || {}, sf = seed.features || {};
    const linked = (song.sources || []).find(s => s.seedId === seed.id);
    const parts = {
      relation: linked ? (linked.type === 'similar' ? 1 : .6) : song.sources?.some(s => s.type === 'daily') ? .25 : null,
      style: overlap(song.tags, seed.tags), mood: overlap(f.mood, sf.mood), theme: overlap(f.theme, sf.theme),
      language: f.language && sf.language ? Number(f.language === sf.language) : null,
      era: song.year && seed.year ? Math.max(0, 1 - Math.abs(song.year - seed.year) / 20) : null,
      duration: song.duration && seed.duration ? Math.max(0, 1 - Math.abs(song.duration - seed.duration) / 180000) : null,
      feedback: seed.localLiked ? 1 : seed.recent ? .7 : seed.liked ? .6 : .3,
      ...audioSimilarity(f,sf)
    };
    let evidence = 0, total = 0;
    for (const [k, value] of Object.entries(parts)) if (value !== null) { total += value * weights[k]; evidence += weights[k]; }
    // Missing evidence never increases artist influence; reliability discounts sparse matches.
    const score = evidence ? total / evidence * (.45 + .55 * Math.min(1, evidence / .80)) : 0;
    const reasons = [];
    if (linked) reasons.push(linked.type === 'similar' ? `网易云将它关联到你喜欢的《${seed.name}》` : `与《${seed.name}》出现在关联歌单中`);
    const shared = (song.tags || []).filter(t => seed.tags?.includes(t));
    if (shared.length) reasons.push(`相关歌单标签接近：${shared.slice(0, 3).join('、')}（歌单层面的线索）`);
    const themes = (f.theme || []).filter(t => sf.theme?.includes(t));
    const moods = (f.mood || []).filter(t => sf.mood?.includes(t));
    if (themes.length || moods.length) reasons.push(`歌词关键词共同涉及${[...themes, ...moods].join('、')}（弱线索）`);
    if (parts.language === 1) reasons.push(`歌词语言与《${seed.name}》接近`);
    const instruments=f.audio?.instruments?.map(i=>i.name).filter(n=>sf.audio?.instruments?.some(i=>i.name===n))||[];
    if(instruments.length)reasons.unshift(`可听到相近的${instruments.slice(0,3).join('、')}音色`);
    if(parts.rhythm>.8)reasons.push('节奏速度接近');
    if (seed.localLiked && linked) reasons.push('你在本软件的喜欢反馈提高了这条关联的权重');
    if (score > best.score) best = { score, reasons: reasons.slice(0, 3), breakdown: { ...parts, artist: 0, evidence }, seedId: seed.id };
  }
  if (!best.reasons.length) best.reasons = ['作为新风格探索候选；目前可用于解释的信息较少'];
  if (feedback[song.id]?.value === 'dislike') best.score = -1;
  return best;
}
function identity(song) { return (song.name || '').toLowerCase().replace(/[（(].*?[)）]/g, '').replace(/\s+/g, '') + '|' + (song.artists || []).map(a => a.id || a.name).sort().join(','); }
function recommend(candidates, data, date = dateKey(), omit = [], existing = []) {
  const seeds = data.library.filter(s => data.feedback[s.id]?.value !== 'dislike' && !s.artists.some(a => data.blockedArtists.includes(a.id))).map(s => ({ ...s, localLiked: data.feedback[s.id]?.value === 'like' }));
  const known = new Set([...data.likedIds, ...seeds.map(s => s.id), ...omit]);
  const cutoff = Date.parse(date + 'T00:00:00+08:00') - (data.settings.repeatDays||14) * 86400000;
  const recent = new Set(data.history.filter(h => h.date !== date && Date.parse(h.date + 'T00:00:00+08:00') >= cutoff).flatMap(h => h.songs.map(s => s.id)));
  const blocked = new Set(data.blockedArtists);
  const knownArtists=new Set(data.library.flatMap(s=>s.artists.map(a=>a.id).filter(Boolean)));
  const unique = new Map();
  for (const s of candidates) if (!known.has(s.id) && !recent.has(s.id) && !s.unavailable && data.feedback[s.id]?.value !== 'dislike' && data.feedback[s.id]?.value !== 'like' && !s.artists.some(a => blocked.has(a.id) || (data.settings.avoidKnownArtists!==false&&knownArtists.has(a.id)))) unique.set(s.id, { ...s, ...rankSong(s, seeds, data.feedback, data.settings) });
  const pool = [...unique.values()].sort((a, b) => b.score - a.score || hash(date + a.id) - hash(date + b.id));
  const chosen = [], artistCounts = new Map(), albumCounts = new Map(), identities = new Set();
  for (const song of existing) {
    identities.add(identity(song));
    for (const artist of song.artists) artistCounts.set(artist.id, (artistCounts.get(artist.id) || 0) + 1);
    if (song.albumId) albumCounts.set(song.albumId, (albumCounts.get(song.albumId) || 0) + 1);
  }
  const exploration = data.settings.exploration / 100;
  while (chosen.length < data.settings.count && pool.length) {
    const exploreSlot = Math.floor((chosen.length + 1) * exploration) > Math.floor(chosen.length * exploration);
    let bestIndex = -1, bestUtility = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (identities.has(identity(s)) || s.artists.some(a => (artistCounts.get(a.id) || 0) >= (data.settings.artistLimit||1)) || (s.albumId && (albumCounts.get(s.albumId) || 0) >= (data.settings.albumLimit||2))) continue;
      const repeatedArtist = Math.max(0, ...s.artists.map(a => artistCounts.get(a.id) || 0));
      const sharedTags = chosen.length ? Math.max(0, ...chosen.map(c => overlap(c.tags, s.tags) || 0)) : 0;
      const novelty = hash(date + ':' + s.id) / 4294967295;
      const utility = s.score - repeatedArtist * .18 - sharedTags * .06 + (exploreSlot ? novelty * .3 + (s.sources?.some(x => x.type === 'explore') ? .12 : 0) : novelty * .015);
      if (utility > bestUtility) { bestUtility = utility; bestIndex = i; }
    }
    if (bestIndex < 0) break;
    const s = pool.splice(bestIndex, 1)[0];
    s.exploration = exploreSlot;
    chosen.push(s); identities.add(identity(s));
    for (const a of s.artists) artistCounts.set(a.id, (artistCounts.get(a.id) || 0) + 1);
    if (s.albumId) albumCounts.set(s.albumId, (albumCounts.get(s.albumId) || 0) + 1);
  }
  return chosen;
}
function taste(library) {
  const counts = {};
  for (const s of library) for (const tag of s.tags || []) counts[tag] = (counts[tag] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag, count]) => ({ tag, count }));
}
module.exports = { WEIGHTS, effectiveWeights, lexicalFeatures, normalize, rankSong, recommend, taste, dateKey, hash, identity };
