'use strict';
// Shared classification keeps statistics and recommendation filters consistent.
const dimensions={
 style:{title:'风格与氛围',multiple:true,select:s=>s.tags||[]},
 instruments:{title:'乐器',multiple:true,select:s=>s.features?.audio?.instruments?.map(i=>i.name)||[]},
 tempo:{title:'节奏速度',select:s=>{const a=s.features?.audio;return a?.bpm&&a.bpmConfidence>=.25?[a.bpm<90?'舒缓 · 90 BPM 以下':a.bpm<130?'适中 · 90–129 BPM':'明快 · 130 BPM 以上']:[];}},
 timbre:{title:'音色明暗',select:s=>{const a=s.features?.audio;return a?.brightness>0?[a.brightness<1200?'偏温暖':a.brightness<2500?'均衡':'偏明亮']:[];}},
 vocal:{title:'人声比例',select:s=>{const v=s.features?.audio?.vocal;return Number.isFinite(v)?[v>=.5?'人声突出':v>=.2?'人声与器乐交织':'器乐为主']:[];}},
 dynamics:{title:'强弱变化',select:s=>{const v=s.features?.audio?.dynamics;return Number.isFinite(v)?[v<.2?'平稳':v<.6?'有起伏':'变化明显']:[];}},
 language:{title:'歌词语言',select:s=>[s.features?.language]},
 mood:{title:'歌词情绪',multiple:true,select:s=>s.features?.mood||[]},
 theme:{title:'歌词主题',multiple:true,select:s=>s.features?.theme||[]},
 era:{title:'发行年代',select:s=>s.year>1900?[Math.floor(s.year/10)*10+' 年代']:[]},
 duration:{title:'歌曲时长',select:s=>s.duration>0?[s.duration<180000?'3 分钟以下':s.duration<300000?'3–5 分钟':'5 分钟以上']:[]}
};
function types(song,key){return [...new Set((dimensions[key]?.select(song)||[]).filter(x=>x!=null&&x!==''))];}
function avoidedTypes(song,settings={}){return Object.keys(dimensions).flatMap(key=>types(song,key).filter(n=>settings.avoidTypes?.[key]?.includes(n)).map(name=>({key,name})));}
function validateAvoidance(input){
 const typesInput=input.types||{},result={};let count=0;
 if(typeof typesInput!=='object'||Array.isArray(typesInput))throw new Error('筛选选项无效');
 for(const [key,values] of Object.entries(typesInput)){
  if(!Object.hasOwn(dimensions,key)||!Array.isArray(values)||values.length>100||values.some(v=>typeof v!=='string'||!v.trim()||v.length>40))throw new Error('筛选选项无效');
  result[key]=[...new Set(values.map(v=>v.trim()))];count+=result[key].length;
 }
 const strength=Number(input.strength??85);
 if(count>300||![60,85,100].includes(strength))throw new Error('筛选强度无效');
 return {avoidTypes:result,avoidStrength:strength};
}
module.exports={dimensions,types,avoidedTypes,validateAvoidance};
