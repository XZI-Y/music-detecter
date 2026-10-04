'use strict';
class PlayerController {
  constructor(options){this.options=options;this.generation=0;this.state={song:null,queue:[],index:-1,paused:true,loading:false,time:0,duration:0,mode:'sequence',volume:.8,error:'',trial:false};this.bag=[];}
  snapshot(){return {...this.state,queue:this.state.queue.map(s=>({id:s.id,name:s.name,artists:s.artists})),song:this.state.song};}
  changed(){this.options.changed(this.snapshot());}
  async play(queue,id){
    const index=queue.findIndex(s=>s.id===id);if(index<0)throw new Error('播放列表中没有这首歌');
    const generation=++this.generation;
    if(this.state.queue.map(s=>s.id).join(',')!==queue.map(s=>s.id).join(','))this.bag=[];
    this.state={...this.state,queue,index,song:queue[index],loading:true,error:'',time:0,duration:0,paused:true};this.options.send({type:'pause'});this.changed();
    try{const result=await this.options.resolve(id);if(generation!==this.generation)return;this.state.trial=result.trial;this.options.send({type:'load',id,url:result.url,volume:this.state.volume});}
    catch(e){if(generation===this.generation){this.state.loading=false;this.state.error=e.message;this.changed();}throw e;}
  }
  async command(type,value){
    if(type==='toggle'){if(!this.state.song)throw new Error('先选择一首歌曲');this.state.paused=!this.state.paused;this.options.send({type:this.state.paused?'pause':'resume'});this.changed();}
    else if(type==='seek'){const n=Number(value);if(!Number.isFinite(n)||n<0||n>this.state.duration)throw new Error('播放位置无效');this.options.send({type:'seek',time:n});}
    else if(type==='volume'){const n=Number(value);if(!Number.isFinite(n)||n<0||n>1)throw new Error('音量无效');this.state.volume=n;this.options.send({type:'volume',volume:n});this.changed();}
    else if(type==='mode'){if(!['sequence','shuffle'].includes(value))throw new Error('播放模式无效');this.state.mode=value;this.bag=[];this.changed();}
    else if(type==='next'||type==='previous'){
      const q=this.state.queue;if(!q.length)throw new Error('播放列表为空');let index=this.state.index;
      if(type==='previous')index=Math.max(0,index-1);
      else if(this.state.mode==='shuffle'){
        this.bag=this.bag.filter(i=>i!==index&&i<q.length);
        if(!this.bag.length)this.bag=q.map((_,i)=>i).filter(i=>i!==index);
        if(!this.bag.length)index=0;else{const position=Math.floor((this.options.random||Math.random)()*this.bag.length);index=this.bag.splice(position,1)[0];}
      }else if(index+1>=q.length){this.options.send({type:'pause'});this.state.paused=true;this.changed();return;}else index++;
      await this.play(q,q[index].id);
    }else throw new Error('播放操作无效');
  }
  async report(payload){
    if(payload.id!==this.state.song?.id)return;
    if(payload.type==='ended'){this.state.paused=true;this.state.loading=false;await this.command('next');return;}
    if(payload.type==='error'){this.state.error='音源加载失败，请重试或换一首';this.state.loading=false;this.state.paused=true;}
    else {this.state.time=Math.max(0,Number(payload.time)||0);this.state.duration=Math.max(0,Number(payload.duration)||0);this.state.paused=!!payload.paused;this.state.loading=false;this.state.error='';}
    this.changed();
  }
  stop(){this.generation++;this.options.send({type:'pause'});this.state={...this.state,song:null,queue:[],index:-1,paused:true,loading:false,time:0,duration:0};this.changed();}
}
module.exports={PlayerController};
