'use strict';
const { parentPort,workerData }=require('node:worker_threads');
const {signalFeatures,instrumentFeatures}=require('./audio-features');
let classifier;
async function initialize(){
  if(classifier)return classifier;
  const {pipeline,env}=await import('@huggingface/transformers');
  env.allowRemoteModels=false;
  classifier=await pipeline('audio-classification',workerData.modelPath,{dtype:'q8',local_files_only:true,session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
  return classifier;
}
parentPort.on('message',async message=>{
  try {
    const pipe=await initialize(), predictions=[];
    for(const raw of message.clips){const samples=Float32Array.from(raw);const inputs=await pipe.processor(samples);const output=await pipe.model(inputs);const logits=output.logits.data;const labels=pipe.model.config.id2label;predictions.push(Array.from(logits,(x,i)=>({label:labels[i],score:1/(1+Math.exp(-x))})));}
    if(process.env.MUSIC_MODEL_DIAGNOSTICS)console.log("AST top",JSON.stringify(predictions.map(p=>p.sort((a,b)=>b.score-a.score).slice(0,6))));
    const audio={...signalFeatures(message.clips),...instrumentFeatures(predictions), analyzedAt:new Date().toISOString()};
    parentPort.postMessage({id:message.id,audio});
  }catch(e){parentPort.postMessage({id:message.id,error:String(e.message).slice(0,200)});}
});
