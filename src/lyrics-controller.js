'use strict';
const {parse}=require('./lyrics-format');
class LyricsController{
 constructor(options){this.options=options;this.generation=0;this.cache=new Map();this.state={songId:null,status:'idle',lines:[],plain:'',message:'还没有播放音乐'};}
 snapshot(){return this.state;}
 changed(){this.options.changed(this.snapshot());}
 async select(songId,force=false){
  if(songId===this.state.songId&&!force)return;
  const token=++this.generation;
  this.state={songId,status:songId?'loading':'idle',lines:[],plain:'',message:songId?'正在加载歌词…':'还没有播放音乐'};this.changed();if(!songId)return;
  try{
   let result=!force&&this.cache.get(songId);
   if(!result){
    const raw=await this.options.resolve(songId);if(token!==this.generation)return;
    const original=parse(raw.lrc?.lyric),translated=parse(raw.tlyric?.lyric);
    const translations=new Map(translated.lines.map(x=>[Math.round(x.time*1000),x.text]));
    const lines=original.lines.map(x=>({...x,translation:translations.get(Math.round(x.time*1000))||''}));
    const instrumental=raw.nolyric===true||/^纯音乐[，,]/.test(original.plain);
    result={songId,status:instrumental?'unavailable':lines.length?'timed':original.plain?'plain':'unavailable',lines:instrumental?[]:lines,plain:instrumental?'':original.plain,message:instrumental?'纯音乐 · 暂无歌词':lines.length?'歌词随播放进度同步':original.plain?'暂无逐句时间信息':'这首歌暂未提供歌词'};
    this.cache.delete(songId);this.cache.set(songId,result);if(this.cache.size>50)this.cache.delete(this.cache.keys().next().value);
   }
   if(token!==this.generation)return;this.state=result;this.changed();
  }catch{if(token!==this.generation)return;this.state={songId,status:'error',lines:[],plain:'',message:'歌词加载失败，可点击重新加载'};this.changed();}
 }
 clear(){this.cache.clear();return this.select(null,true);}
}
module.exports={LyricsController};
