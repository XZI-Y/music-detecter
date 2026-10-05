const test=require('node:test'),assert=require('node:assert/strict');
const {recommend,normalize}=require('../src/engine');
const {defaults,Store}=require('../src/store');
const {recordSeen,dailyStatus}=require('../src/daily');
const {validateAvoidance}=require('../src/music-types');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function song(id,tags=[]){return normalize({id,name:'song'+id,ar:[{id:id+100}],al:{id:id+500}},tags);}
function data(){const d=defaults();d.library=[song(1,['摇滚'])];d.settings.selected=[7];d.settings.sourceConfirmed=d.settings.analysisStarted=true;return d;}
test('勾选不喜欢的风格会大量减少推荐，探索位也不能绕过配额',()=>{
 const d=data();d.settings.avoidTypes={style:['摇滚']};d.settings.exploration=60;
 const bad=Array.from({length:30},(_,i)=>({...song(i+10,['摇滚']),sources:[{type:'similar',seedId:1}]}));
 const good=Array.from({length:25},(_,i)=>song(i+60,['爵士']));
 const list=recommend([...bad,...good],d,'2026-10-05');assert.equal(list.length,20);assert.ok(list.filter(s=>s.tags.includes('摇滚')).length<=3);
 assert.equal(recommend(bad,d,'2026-10-05').length,3);
});
test('严格筛选覆盖各因素；未知音频保持未知且取消筛选立即恢复',()=>{
 const d=data();d.settings.avoidTypes={instruments:['钢琴'],language:['日语']};d.settings.avoidStrength=100;
 const piano=song(2);piano.features.audio={instruments:[{name:'钢琴'}]};const japanese=song(3);japanese.features.language='日语';const unknown=song(4);
 assert.deepEqual(recommend([piano,japanese,unknown],d,'2026-10-05').map(s=>s.id),[4]);d.settings.avoidTypes={};assert.equal(recommend([piano,japanese,unknown],d,'2026-10-05').length,3);
 assert.throws(()=>validateAvoidance({types:{unknown:['a']}}));assert.throws(()=>validateAvoidance({strength:101}));
});
test('同一天刷新和换一首都排除已曝光歌曲及同歌手版本，覆盖历史后仍保留记录',()=>{
 const d=data(),old=song(2),current=song(3),fresh=song(4),version={...song(5),name:old.name+' (Live)',artists:old.artists};
 recordSeen(d,[old],'2026-10-05T01:00:00Z');d.history=[{date:'2026-10-05',songs:[current]}];
 assert.deepEqual(recommend([old,current,version,fresh],d,'2026-10-05').map(s=>s.id),[4]);
 assert.deepEqual(recommend([old,current],d,'2026-10-05'),[]);assert.equal(d.history[0].songs[0].id,3);
});
test('曝光记录重启保留，旧历史迁移不会覆盖最近推荐时间',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-seen-'));try{const store=new Store(dir),s=song(2);recordSeen(store.data,[s],'2026-10-05T02:00:00Z');recordSeen(store.data,[s],'2026-10-01T02:00:00Z');store.save();assert.equal(new Store(dir).data.seenRecommendations[0].at,'2026-10-05T02:00:00Z');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('每日状态遵守北京时间、计划时间、更新成功及失败重试提示',()=>{
 const d=data();assert.equal(dailyStatus(d,true,false,new Date('2026-10-04T17:00:00Z')).status,'scheduled');assert.equal(dailyStatus(d,true,false,new Date('2026-10-05T02:00:00Z')).status,'due');
 d.history=[{date:'2026-10-05',createdAt:'2026-10-05T02:00:00Z',songs:[song(2)]}];const ready=dailyStatus(d,true,false,new Date('2026-10-05T03:00:00Z'));assert.equal(ready.status,'ready');assert.equal(ready.nextAt,'2026-10-06T00:00:00.000Z');
 d.dailyUpdate={date:'2026-10-05',status:'error',message:'没有新的候选',nextRetryAt:'2026-10-05T03:05:00Z'};const error=dailyStatus(d,true,false,new Date('2026-10-05T03:00:00Z'));assert.equal(error.status,'error');assert.equal(error.message,'没有新的候选');assert.ok(error.updatedAt);
 d.dailyUpdate.status='updating';assert.equal(dailyStatus(d,true,true,new Date('2026-10-05T03:00:00Z')).status,'updating');
});

test("当日手动换歌失败也进入重试，不被已存在歌单或计划时间挡住",()=>{const {dailyRetry}=require("../src/daily"),d=defaults(),now=new Date("2026-10-05T00:00:00+08:00");d.history=[{date:"2026-10-05",songs:[]}];d.dailyUpdate={status:"error",date:"2026-10-05"};assert.equal(dailyRetry(d,now),true);d.dailyUpdate.status="success";assert.equal(dailyRetry(d,now),false);d.dailyUpdate={status:"error",date:"2026-10-04"};assert.equal(dailyRetry(d,now),false);});
