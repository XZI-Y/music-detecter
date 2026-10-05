'use strict';
function archiveSongs(data,songs,now=new Date().toISOString()){
  data.analysisArchive ||= {};
  for(const song of songs){
    const old=data.analysisArchive[song.id];
    const features={...old?.features};for(const [key,value] of Object.entries(song.features||{}))if(value!=null&&(!Array.isArray(value)||value.length)||!(key in features))features[key]=value;
    data.analysisArchive[song.id]={id:song.id,name:song.name??old?.name,artists:song.artists??old?.artists,album:song.album??old?.album,albumId:song.albumId??old?.albumId,duration:song.duration>0?song.duration:old?.duration,year:song.year>1900?song.year:old?.year,tags:[...new Set([...(old?.tags||[]),...(song.tags||[])])],features,firstAnalyzedAt:old?.firstAnalyzedAt||now,lastAnalyzedAt:now};
  }
}
function summarize(songs){
  const groups={};
  function dimension(key,title,select){
    const counts=new Map();let known=0;
    for(const s of songs){const names=[...new Set(select(s).filter(x=>x!=null&&x!==''))];if(names.length)known++;for(const n of names)counts.set(n,(counts.get(n)||0)+1);}
    groups[key]={title,total:songs.length,known,unknown:songs.length-known,multiple:['style','mood','theme','instruments'].includes(key),rows:[...counts].sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count,percent:known?Math.round(count/known*1000)/10:0}))};
  }
  dimension('style','风格与氛围',s=>s.tags||[]);
  dimension('instruments','乐器',s=>s.features?.audio?.instruments?.map(i=>i.name)||[]);
  dimension('tempo','节奏速度',s=>{const a=s.features?.audio;return a?.bpm&&a.bpmConfidence>=.25?[a.bpm<90?'舒缓 · 90 BPM 以下':a.bpm<130?'适中 · 90–129 BPM':'明快 · 130 BPM 以上']:[];});
  dimension('timbre','音色明暗',s=>{const a=s.features?.audio;return a?.brightness>0?[a.brightness<1200?'偏温暖':a.brightness<2500?'均衡':'偏明亮']:[];});
  dimension('vocal','人声比例',s=>{const v=s.features?.audio?.vocal;return Number.isFinite(v)?[v>=.5?'人声突出':v>=.2?'人声与器乐交织':'器乐为主']:[];});
  dimension('dynamics','强弱变化',s=>{const v=s.features?.audio?.dynamics;return Number.isFinite(v)?[v<.2?'平稳':v<.6?'有起伏':'变化明显']:[];});
  dimension('language','歌词语言',s=>[s.features?.language]);
  dimension('mood','歌词情绪',s=>s.features?.mood||[]);
  dimension('theme','歌词主题',s=>s.features?.theme||[]);
  dimension('era','发行年代',s=>s.year>1900?[Math.floor(s.year/10)*10+' 年代']:[]);
  dimension('duration','歌曲时长',s=>s.duration>0?[s.duration<180000?'3 分钟以下':s.duration<300000?'3–5 分钟':'5 分钟以上']:[]);
  const audio=songs.filter(s=>s.features?.audio).length,lyrics=songs.filter(s=>s.features?.lyricAnalyzed||s.features?.language).length;
  return {total:songs.length,audio,lyrics,groups};
}
function statistics(data){
  return {current:summarize(data.library),archive:summarize(Object.values(data.analysisArchive||{})),runs:(data.analysisRuns||[]).slice(-30).reverse()};
}
function recordAnalysis(data){
  archiveSongs(data,data.library);
  data.analysisRuns ||= [];
  const latest={at:new Date().toISOString(),sources:[...data.settings.selected],total:data.library.length,audio:data.library.filter(s=>s.features?.audio).length,lyrics:data.library.filter(s=>s.features?.lyricAnalyzed||s.features?.language).length};
  data.analysisRuns.push(latest);data.analysisRuns=data.analysisRuns.slice(-365);
}
module.exports={archiveSongs,summarize,statistics,recordAnalysis};
