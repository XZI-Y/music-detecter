const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILES=require('./audio-model-files.json');
const BASE='https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593/resolve/249a1fbf0286b40e7f1ed687a8ae396997bf7dc6/';
class AudioModel{
 constructor({dataPath,legacyPath,progress=()=>{},fetcher=fetch,files=FILES,base=BASE}){Object.assign(this,{dir:path.join(dataPath,'models','ast'),legacyPath,progress,fetcher,files,base});this.ready=false;this.running=null;this.abort=new AbortController();}
 async valid(file,item){try{if(fs.statSync(file).size!==item.bytes)return false;const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')===item.sha256;}catch{return false;}}
 ensure(){if(this.ready)return Promise.resolve(this.dir);if(!this.running)this.running=this.prepare().finally(()=>{this.running=null;});return this.running;}
 async prepare(){
  for(const item of this.files){
   if(this.abort.signal.aborted)throw new Error('音频模型准备已停止');
   const target=path.join(this.dir,item.name);fs.mkdirSync(path.dirname(target),{recursive:true});if(await this.valid(target,item))continue;
   const legacy=this.legacyPath&&path.join(this.legacyPath,item.name);
   if(legacy&&await this.valid(legacy,item)){fs.copyFileSync(legacy,target+'.tmp');fs.renameSync(target+'.tmp',target);continue;}
   let completed=false;
   for(let attempt=0;attempt<3&&!completed;attempt++){
    let handle;
    try{
     const partial=target+'.part';let bytes=fs.existsSync(partial)?fs.statSync(partial).size:0;
     if(bytes>item.bytes){fs.unlinkSync(partial);bytes=0;}
     if(bytes<item.bytes){
      const response=await this.fetcher(this.base+item.name,{headers:bytes?{Range:'bytes='+bytes+'-'}:{},signal:AbortSignal.any([this.abort.signal,AbortSignal.timeout(900000)])});
      if(!response.ok||!response.body)throw new Error('下载连接失败');
      if(response.status===206){if(!new RegExp('^bytes '+bytes+'-\\d+/'+item.bytes+'$').test(response.headers.get('content-range')||''))throw new Error('续传范围无效');}else if(bytes)bytes=0;
      handle=fs.openSync(partial,bytes?'a':'w');let last=0;
      for await(const chunk of response.body){if(this.abort.signal.aborted)throw new Error('已停止');bytes+=chunk.length;if(bytes>item.bytes)throw new Error('模型大小异常');fs.writeSync(handle,chunk);if(Date.now()-last>500){last=Date.now();this.progress('首次准备音频识别模型 · '+Math.floor(bytes/item.bytes*100)+'%（以后升级无需重下）');}}
      fs.closeSync(handle);handle=undefined;
     }
     if(!await this.valid(partial,item)){if(fs.existsSync(partial)&&fs.statSync(partial).size===item.bytes)fs.unlinkSync(partial);throw new Error('模型尚未完整下载或校验失败');}
     fs.renameSync(partial,target);completed=true;
    }catch(e){if(this.abort.signal.aborted||attempt===2)throw new Error('音频识别模型暂未就绪，已保留下载进度，请稍后重试');}
    finally{if(handle!==undefined)fs.closeSync(handle);}
   }
  }
  this.ready=true;return this.dir;
 }
 close(){this.abort.abort();}
}
module.exports={AudioModel,FILES};
