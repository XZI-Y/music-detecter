(function(root){
 'use strict';
 function parse(text){
  const lines=[],plain=[];
  for(const raw of String(text||'').slice(0,150000).split(/\r?\n/).slice(0,3000)){
   const tags=[...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
   const content=raw.replace(/\[[^\]]*\]/g,'').trim().slice(0,1000);
   if(!content)continue;
   if(tags.length){for(const tag of tags)if(Number(tag[2])<60)lines.push({time:Number(tag[1])*60+Number(tag[2])+Number('0.'+(tag[3]||'0')),text:content});}
   else if(!/^\s*\[[a-z]+:/i.test(raw))plain.push(content);
  }
  lines.sort((a,b)=>a.time-b.time);
  return {lines:lines.filter((x,i)=>!i||x.time!==lines[i-1].time||x.text!==lines[i-1].text),plain:plain.join('\n')};
 }
 function current(lines,time){let low=0,high=lines.length-1,result=-1;while(low<=high){const mid=(low+high)>>1;if(lines[mid].time<=time){result=mid;low=mid+1;}else high=mid-1;}return result;}
 const api={parse,current};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LyricFormat=api;
})(typeof window!=='undefined'?window:globalThis);
