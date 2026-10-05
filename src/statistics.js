'use strict';
const {dimensions,types}=require('./music-types');
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
  for(const [key,definition] of Object.entries(dimensions))dimension(key,definition.title,s=>types(s,key));
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
