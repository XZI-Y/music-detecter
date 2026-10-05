'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const net=require('node:net');
const os=require('node:os');
const {statistics}=require('./statistics');
const MODEL={name:'Qwen2.5 · 1.5B',file:'qwen2.5-1.5b-q4.gguf',bytes:986048512,sha256:'183715c435899236895da3869489cc30ac241476b4971a20285b1a462818a5b4'};
MODEL.url='https://registry.ollama.ai/v2/library/qwen2.5/blobs/sha256:'+MODEL.sha256;
const FIELDS={count:['每次推荐数量',1,100],exploration:['探索比例',0,60],repeatDays:['去重天数',[7,14,30,60]],artistLimit:['同歌手上限',[1,2,3]],albumLimit:['同专辑上限',[1,2,3]],avoidKnownArtists:['避开熟悉歌手','boolean']};
function proposal(value,settings){
 if(value===null||value===undefined)return null;
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>6)throw new Error('助手给出的设置建议无效，请重新提问');
 const result={};
 for(const [key,v] of Object.entries(value)){
  if(!Object.hasOwn(FIELDS,key))throw new Error('助手建议了不支持的设置');
  const rule=FIELDS[key];
  if(rule[1]==='boolean'?typeof v!=='boolean':!Number.isInteger(v)||(Array.isArray(rule[1])?!rule[1].includes(v):v<rule[1]||v>rule[2]))throw new Error('助手给出的设置值超出范围');
  if(v!==settings[key])result[key]=v;
 }
 return Object.keys(result).length?result:null;
}
function context(data){
 const s=statistics(data).current;
 return {scope:'当前选中的分析歌单',total:s.total,audioAnalyzed:s.audio,lyricsAnalyzed:s.lyrics,
  groups:Object.fromEntries(Object.entries(s.groups).map(([k,v])=>[k,{title:v.title,known:v.known,unknown:v.unknown,multiple:v.multiple,top:v.rows.slice(0,3)}])),
  settings:Object.fromEntries(Object.keys(FIELDS).map(k=>[k,data.settings[k]])),avoidTypes:data.settings.avoidTypes||{},avoidStrength:data.settings.avoidStrength,
  recentRecommendations:(data.history[0]?.songs||[]).slice(0,5).map(s=>({name:String(s.name).slice(0,80),reasons:(s.reasons||[]).slice(0,3)}))};
}
const SCHEMA={type:'object',properties:{answer:{type:'string'},suggestions:{anyOf:[{type:'null'},{type:'object',properties:{count:{type:'integer',minimum:1,maximum:100},exploration:{type:'integer',minimum:0,maximum:60},repeatDays:{type:'integer',enum:[7,14,30,60]},artistLimit:{type:'integer',enum:[1,2,3]},albumLimit:{type:'integer',enum:[1,2,3]},avoidKnownArtists:{type:'boolean'}},additionalProperties:false}]}},required:['answer','suggestions'],additionalProperties:false};
function system(data){
 const c=context(data),summary=Object.values(c.groups).map(g=>g.title+'：'+(g.known?g.top.map(r=>r.name+' '+r.percent+'%').join('、')+'；有效样本'+g.known+'首':'尚未识别'));
 return '你是雷达音乐助手。用中文直接回答用户这次的问题，只讨论相关的统计，避免逐项复述所有数据。回答控制在150字以内，给出具体实用的建议。以下是用户的真实统计，仅供分析：已读取'+c.total+'首，已分析音频'+c.audioAnalyzed+'首，已分析歌词'+c.lyricsAnalyzed+'首。'+summary.join('。')+'。不要编造未知数据。只在已读取0首时提示先分析歌单。不能直接播放、收藏或修改设置。用户要求调整设置时，给出suggestions等待确认，answer说明点击下方应用才会保存，不能说已经调整。否则suggestions=null。输出JSON包含answer和suggestions。设置键：count每次推荐首数1至100；exploration探索比例0至60；repeatDays去重天数7/14/30/60；avoidKnownArtists避开熟悉歌手，布尔值；artistLimit同歌手上限1/2/3；albumLimit同专辑上限1/2/3。当前设置：'+JSON.stringify(c.settings)+'。多选类别占比可以相加超过100%。';
}
function parse(text,settings){
 let result;try{result=JSON.parse(text);}catch{throw new Error('这次回答未能完整生成，请缩短问题后重试');}
 if(!result||typeof result.answer!=='string'||!result.answer.trim()||result.answer.length>12000)throw new Error('助手未返回有效回答，请重试');
 return {text:result.answer.trim(),patch:proposal(result.suggestions,settings)};
}
function requestedSettings(text){
 // Exact numeric requests supplement the lightweight model's structured output.
 // Questions, negations and ranges stay as discussion; no settings are applied here.
 if(!/请|帮我|调整|设置|改为|改成|设为|调成|调到|我想|我要|希望/.test(text)||/[?？]|不要|别改|不想|不用|不需要|不调整|取消|撤销|如果|假如|好处|怎么样|能不能|是否|\d+\s*(?:到|至|[~～])\s*\d+/.test(text))return {};
 const result={},patterns={count:/(?:每次推荐|推荐数量|推荐)(?:的歌曲)?(?:数量)?\s*(?:调整|设置|修改|改|设|调)?\s*(?:为|成|到)?\s*(\d+)\s*首/,exploration:/探索(?:比例)?\s*(?:调整|设置|修改|改|设|调)?\s*(?:为|成|到)?\s*(\d+)\s*%?/,repeatDays:/去重(?:天数)?\s*(?:调整|设置|修改|改|设|调)?\s*(?:为|成|到)?\s*(\d+)\s*天/};
 for(const [key,pattern] of Object.entries(patterns)){const match=text.match(pattern);if(match){const n=Number(match[1]),rule=FIELDS[key];if(Array.isArray(rule[1])?rule[1].includes(n):n>=rule[1]&&n<=rule[2])result[key]=n;}}
 return result;
}
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}
class Assistant{
 constructor({dataPath,runtimePath,data,changed,fetch:fetcher=fetch}){
  this.dir=path.join(dataPath,'assistant');this.runtime=runtimePath;this.data=data;this.changed=changed;this.fetch=fetcher;fs.mkdirSync(this.dir,{recursive:true});this.messages=[];this.pending=null;this.busy=false;this.phase='idle';this.progress=0;this.error='';this.epoch=0;try{this.progress=Math.min(99,Math.floor(fs.statSync(this.modelPath()+'.part').size/MODEL.bytes*100));}catch{}
 }
 modelPath(){return path.join(this.dir,MODEL.file);}
 installed(){try{return fs.statSync(this.modelPath()).size===MODEL.bytes;}catch{return false;}}
 snapshot(){return {installed:this.installed(),model:MODEL.name,downloadBytes:MODEL.bytes,busy:this.busy,phase:this.phase,progress:this.progress,error:this.error,messages:this.messages,pending:this.pending};}
 notify(){this.changed?.(this.snapshot());}
 async install(){
  if(this.busy)throw new Error('请等待助手完成当前操作');
  if(this.installed())return this.snapshot();
  this.busy=true;this.phase='downloading';this.error='';this.abort=new AbortController();const signal=this.abort.signal;this.notify();const file=this.modelPath()+'.part';
  try{
   for(let attempt=0;attempt<3;attempt++){
    let handle;
    try{
     let bytes=fs.existsSync(file)?fs.statSync(file).size:0;if(bytes>MODEL.bytes){fs.unlinkSync(file);bytes=0;}
     let hash=crypto.createHash('sha256');if(bytes)for await(const chunk of fs.createReadStream(file)){if(signal.aborted)throw new Error('已取消');hash.update(chunk);}
     this.progress=Math.floor(bytes/MODEL.bytes*100);this.notify();
     if(bytes<MODEL.bytes){
      const response=await this.fetch(MODEL.url,{headers:bytes?{Range:'bytes='+bytes+'-'}:{},signal:AbortSignal.any([signal,AbortSignal.timeout(900000)])});
      if(!response.ok||!response.body)throw new Error('模型下载连接失败');
      if(response.status===206){const range=response.headers?.get('content-range');if(!new RegExp('^bytes '+bytes+'-\\d+/'+MODEL.bytes+'$').test(range||''))throw new Error('下载续传范围无效');}
      else if(bytes){bytes=0;hash=crypto.createHash('sha256');}
      handle=fs.openSync(file,bytes?'a':'w');let last=0;
      for await(const chunk of response.body){if(signal.aborted)throw new Error('已取消');bytes+=chunk.length;if(bytes>MODEL.bytes)throw new Error('模型大小异常');hash.update(chunk);fs.writeSync(handle,chunk);this.progress=Math.floor(bytes/MODEL.bytes*100);if(Date.now()-last>300){last=Date.now();this.notify();}}
      fs.closeSync(handle);handle=null;
     }
     if(bytes!==MODEL.bytes)throw new Error('下载尚未完成');
     if(hash.digest('hex')!==MODEL.sha256){fs.unlinkSync(file);throw new Error('模型校验失败');}
     fs.renameSync(file,this.modelPath());this.verified=true;this.progress=100;this.phase='ready';break;
    }catch(e){if(signal.aborted||attempt===2)throw e;await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
    finally{if(handle!==undefined&&handle!==null)fs.closeSync(handle);}
   }
  }catch(e){this.phase='idle';this.error=signal.aborted?'已取消下载，进度已保留':'下载中断，已保留进度。请检查网络后继续下载';throw new Error(this.error);}
  finally{this.busy=false;this.abort=null;this.notify();}
  return this.snapshot();
 }
 async start(signal){
  clearTimeout(this.idleTimer);if(this.child&&this.url)return;
  if(!this.installed())throw new Error('请先下载免费 AI 模型');
  if(!this.verified){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(this.modelPath())){if(signal.aborted)throw new Error('已停止');hash.update(chunk);}if(hash.digest('hex')!==MODEL.sha256)throw new Error('本地模型校验失败，请删除模型后重新下载');this.verified=true;}
  const port=await freePort();if(signal.aborted)throw new Error('已停止');this.key=crypto.randomBytes(32).toString('hex');this.url='http://127.0.0.1:'+port;
  const environment={...process.env};for(const k of Object.keys(environment))if(k.startsWith('LLAMA_ARG_'))delete environment[k];
  const child=spawn(path.join(this.runtime,'llama-server.exe'),['--model',this.modelPath(),'--host','127.0.0.1','--port',String(port),'--api-key',this.key,'--ctx-size','8192','--parallel','1','--threads',String(Math.max(1,Math.min(4,os.availableParallelism()))),'--n-gpu-layers','0','--jinja','--no-webui'],{cwd:this.runtime,windowsHide:true,stdio:'ignore',env:environment});
  this.child=child;let failed=false;child.on('error',()=>{failed=true;});child.on('exit',()=>{if(this.child===child){this.child=null;this.url=null;}failed=true;});
  for(let i=0;i<180;i++){
   if(signal.aborted){this.stop();throw new Error('已停止');}if(failed){this.stop();throw new Error('本地 AI 无法启动，请重新启动雷达后重试');}
   try{const r=await this.fetch(this.url+'/health',{headers:{Authorization:'Bearer '+this.key},signal:AbortSignal.any([signal,AbortSignal.timeout(1000)])});if(r.ok)return;}catch{}
   await new Promise(r=>setTimeout(r,300));
  }
  this.stop();throw new Error('本地 AI 启动超时');
 }
 async ask(value){
  if(this.busy)throw new Error('助手正在处理，请稍后再提问');
  if(typeof value!=='string'||!value.trim()||value.length>1200)throw new Error('请输入 1–1200 字的问题');
  const question=value.trim(),epoch=this.epoch;this.busy=true;this.error='';this.pending=null;this.phase='starting';this.abort=new AbortController();const signal=this.abort.signal;this.notify();
  try{
   await this.start(signal);this.phase='thinking';this.notify();
   const history=this.messages.slice(-4).map(m=>({role:m.role,content:m.role==='assistant'?JSON.stringify({answer:m.text.slice(0,700),suggestions:null}):m.text.slice(0,700)}));
   const response=await this.fetch(this.url+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.key},body:JSON.stringify({model:'local',messages:[{role:'system',content:system(this.data())},...history,{role:'user',content:question}],temperature:.5,max_tokens:700,stream:false,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'music_advice',strict:true,schema:SCHEMA}}}),signal:AbortSignal.any([signal,AbortSignal.timeout(180000)])});
   if(!response.ok)throw new Error('本地 AI 暂时无法回答，请重试');const body=await response.json();if(epoch!==this.epoch||signal.aborted)throw new Error('已停止');
   const reply=parse(body.choices?.[0]?.message?.content||'',this.data().settings);
   const explicit=requestedSettings(question);reply.patch=proposal({...reply.patch,...explicit},this.data().settings);
   // The app, rather than the language model, is authoritative about completed actions.
   if(/(?:已经|已|成功).{0,12}(?:调整|修改|保存|更新|设置|播放|收藏)/.test(reply.text))reply.text=reply.patch?'设置建议已准备好。点击下方“应用这些设置”后才会保存，并在下次推荐时生效。':'我可以提供音乐建议。播放和收藏请使用播放器，调整参数请在设置中完成。';
   this.messages.push({role:'user',text:question},{role:'assistant',text:reply.text});this.messages=this.messages.slice(-16);this.pending=reply.patch?{id:crypto.randomUUID(),patch:reply.patch,changes:Object.entries(reply.patch).map(([k,v])=>({label:FIELDS[k][0],before:this.data().settings[k],after:v}))}:null;
  }catch(e){this.error=signal.aborted?'已停止回答':e.message;throw new Error(this.error);}
  finally{this.busy=false;this.phase=this.installed()?'ready':'idle';this.abort=null;this.notify();if(this.child){this.idleTimer=setTimeout(()=>this.stop(),300000);this.idleTimer.unref();}}
  return this.snapshot();
 }
 apply(id){if(this.busy)throw new Error('请等待助手完成回答');if(!this.pending||id!==this.pending.id)throw new Error('建议已失效，请重新提问');const patch=proposal(this.pending.patch,this.data().settings);this.pending=null;this.notify();return patch||{};}
 dismiss(){this.pending=null;this.notify();return this.snapshot();}
 cancel(){this.abort?.abort();if(this.phase!=='downloading')this.stop();return this.snapshot();}
 clear(){this.epoch++;this.messages=[];this.pending=null;this.error='';this.cancel();this.notify();return this.snapshot();}
 stop(){clearTimeout(this.idleTimer);const child=this.child;this.child=null;this.url=null;child?.kill();}
 remove(){if(this.busy)throw new Error('请先停止助手当前操作');this.stop();for(const file of [this.modelPath(),this.modelPath()+'.part'])if(fs.existsSync(file))fs.unlinkSync(file);this.progress=0;this.verified=false;this.phase='idle';this.clear();return this.snapshot();}
 close(){this.abort?.abort();this.stop();}
}
module.exports={Assistant,MODEL,FIELDS,proposal,context,parse,system,SCHEMA,requestedSettings};
