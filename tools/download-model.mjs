import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const revision='249a1fbf0286b40e7f1ed687a8ae396997bf7dc6';
const model='Xenova/ast-finetuned-audioset-10-10-0.4593';
const expected='807d244b58a30eaa89f0a721fb841619c696857aabe4eac93769bd0b61497f61';
for(const file of ['config.json','preprocessor_config.json','onnx/model_quantized.onnx']){
  const destination=path.resolve('models/ast',file);
  if(await fs.stat(destination).catch(()=>null)){
    if(!file.endsWith('.onnx')||crypto.createHash('sha256').update(await fs.readFile(destination)).digest('hex')===expected)continue;
  }
  let bytes;
  for(const host of [process.env.MODEL_ENDPOINT||'https://huggingface.co','https://hf-mirror.com']){
    try{const response=await fetch(`${host}/${model}/resolve/${revision}/${file}`,{signal:AbortSignal.timeout(300000)});if(!response.ok)throw new Error(String(response.status));bytes=Buffer.from(await response.arrayBuffer());break;}catch{}
  }
  if(!bytes)throw new Error('无法下载音频模型：'+file);
  if(file.endsWith('.onnx')&&crypto.createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('模型校验失败');
  if(file.endsWith('.json'))JSON.parse(bytes.toString('utf8'));
  await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination+'.tmp',bytes);await fs.rename(destination+'.tmp',destination);
  console.log('已准备 '+file);
}
