'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Worker}=require('node:worker_threads');
class AudioAnalysis {
  constructor(options){this.options=options;this.file=path.join(options.dataPath,'audio-cache.json');this.cache={};this.failures=new Map();this.worker=null;this.pending=new Map();this.sequence=0;try{this.cache=JSON.parse(fs.readFileSync(this.file,'utf8'));}catch{}}
  save(){fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.cache));fs.renameSync(this.file+'.tmp',this.file);}
  attach(song){return this.cache[song.id]?{...song,features:{...song.features,audio:this.cache[song.id]}}:song;}
  async classify(clips){
    if(!this.worker){if(this.options.prepareModel)this.options.modelPath=await this.options.prepareModel();this.worker=new Worker(path.join(__dirname,'inference-worker.js'),{workerData:{modelPath:this.options.modelPath}});this.worker.on('message',r=>{const p=this.pending.get(r.id);if(p){clearTimeout(p.timer);this.pending.delete(r.id);r.error?p.reject(new Error(r.error)):p.resolve(r.audio);}});this.worker.on('error',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('音频识别暂不可用'));}this.pending.clear();this.worker=null;});this.worker.unref();}
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.worker?.terminate();this.worker=null;reject(new Error('音频识别超时'));},120000);this.pending.set(id,{resolve,reject,timer});this.worker.postMessage({id,clips});});
  }
  async analyze(song){
    if(this.cache[song.id])return this.attach(song);
    const media=await this.options.connector.playback(song.id);
    const bytes=await this.options.fetchAudio(media.url);
    const clips=await this.options.decode(bytes);
    const audio=await this.classify(clips);
    audio.trial=media.trial;this.cache[song.id]=audio;this.save();const enriched=this.attach(song);this.options.onAnalyzed?.(enriched);return enriched;
  }
  async batch(songs,limit=24){
    const result=songs.map(s=>this.attach(s));let completed=0,failed=0;
    for(let i=0;i<result.length&&completed+failed<limit;i++){
      if(this.options.connector.cancelled)throw new Error('操作已取消');
      if(result[i].features?.audio)continue;
      if((this.failures.get(result[i].id)||0)>Date.now())continue;
      this.options.progress(`正在听取音乐特征 ${completed+failed+1}/${limit}…`);
      try{result[i]=await this.analyze(result[i]);completed++;this.failures.delete(result[i].id);}catch(e){if(e.message==='操作已取消')throw e;this.failures.set(result[i].id,Date.now()+21600000);failed++;}
    }
    return {songs:result,completed,failed};
  }
  clear(){this.cache={};this.failures.clear();this.save();}
  close(){this.worker?.terminate();}
}
module.exports={AudioAnalysis};
