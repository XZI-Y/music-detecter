(function(root){
 'use strict';
 const defaults={mode:'dark',material:'smooth',hue:140,saturation:40};
 function validate(value={}){
  const result={...defaults,...value};
  if(!['dark','light','system'].includes(result.mode)||!['smooth','glass','flat'].includes(result.material)||!Number.isInteger(result.hue)||result.hue<0||result.hue>360||!Number.isInteger(result.saturation)||result.saturation<15||result.saturation>90)throw new Error('外观设置无效');
  return {mode:result.mode,material:result.material,hue:result.hue,saturation:result.saturation};
 }
 let current=defaults,watching=false;
 function apply(value){
  current=validate(value);const doc=root.document;if(!doc)return current;
  const media=root.matchMedia('(prefers-color-scheme: dark)');
  doc.documentElement.dataset.mode=current.mode==='system'?(media.matches?'dark':'light'):current.mode;
  doc.documentElement.dataset.material=current.material;
  doc.documentElement.style.setProperty('--hue',current.hue);doc.documentElement.style.setProperty('--sat',current.saturation+'%');
  if(!watching){media.addEventListener('change',()=>{if(current.mode==='system')apply(current);});watching=true;}
  return current;
 }
 const api={defaults,validate,apply};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RadarAppearance=api;
})(typeof window!=='undefined'?window:globalThis);
