const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Assistant,proposal,context,parse,MODEL,requestedSettings}=require('../src/assistant');const {defaults}=require('../src/store');
function fixture(t,fetch){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-ai-'));const data=defaults();const ai=new Assistant({dataPath:dir,runtimePath:dir,data:()=>data,fetch});t.after(()=>{ai.close();fs.rmSync(dir,{recursive:true,force:true});});return {ai,data,dir};}
test('AI context includes coverage, excludes credentials, lyrics and account identity',()=>{
 const d=defaults();d.profile={id:99,name:'private account'};d.cookie='secret';d.library=[{id:1,name:'sample',tags:['爵士'],features:{lyric:'private lyrics',language:'中文'}}];d.settings.selected=[123];
 const c=context(d),text=JSON.stringify(c);assert.equal(c.total,1);assert.equal(c.audioAnalyzed,0);assert.equal(c.groups.instruments.unknown,1);assert.equal(c.groups.style.top[0].name,'爵士');for(const v of ['secret','private account','private lyrics','selected','123'])assert(!text.includes(v));
});
test('Proposals validate every field and reject unsupported actions or ranges',()=>{
 const s=defaults().settings;assert.deepEqual(proposal({count:30,avoidKnownArtists:true},s),{count:30});assert.equal(proposal({count:s.count},s),null);
 for(const p of [{cookie:'x'},{selected:[]},{count:101},{exploration:61},{repeatDays:15},{artistLimit:4},{albumLimit:0},{avoidKnownArtists:'true'},[],JSON.parse('{"__proto__":{}}')])assert.throws(()=>proposal(p,s));
 assert.throws(()=>parse('not json',s));assert.throws(()=>parse('{"answer":"","suggestions":null}',s));
});
test('Assistant suggests changes without changing settings; only apply with current ID works',async t=>{
 let request;const {ai,data}=fixture(t,async(url,o)=>{request=JSON.parse(o.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answer:'可以调整到30首。',suggestions:{count:30}})}}]})};});ai.installed=()=>true;ai.start=async()=>{ai.url='http://127.0.0.1:12345';};
 const result=await ai.ask('请推荐30首');assert.equal(data.settings.count,20);assert.equal(result.pending.patch.count,30);assert.equal(request.chat_template_kwargs.enable_thinking,false);assert.equal(request.response_format.type,'json_schema');assert.throws(()=>ai.apply('old'));assert.deepEqual(ai.apply(result.pending.id),{count:30});assert.throws(()=>ai.apply(result.pending.id));
});
test('Clearing during an answer cancels it and prevents data crossing account boundaries',async t=>{
 let finish;const {ai}=fixture(t,()=>new Promise(r=>{finish=r;}));ai.installed=()=>true;ai.start=async()=>{ai.url='http://127.0.0.1:1';};const pending=ai.ask('解释偏好');await new Promise(r=>setImmediate(r));assert.equal(ai.busy,true);await assert.rejects(ai.ask('第二个问题'),/稍后/);ai.clear();finish({ok:true,json:async()=>({choices:[{message:{content:'{"answer":"old account","suggestions":null}'}}]})});await assert.rejects(pending,/停止/);assert.equal(ai.messages.length,0);assert.equal(ai.pending,null);
});
test('Incomplete model download keeps resumable progress and never becomes installed',async t=>{
 const {ai,dir}=fixture(t,async()=>({ok:true,status:200,body:(async function*(){yield Buffer.from('incomplete model');})()}));await assert.rejects(ai.install(),/下载中断/);assert.equal(ai.installed(),false);assert.deepEqual(fs.readdirSync(path.join(dir,'assistant')),[MODEL.file+'.part']);assert.equal(ai.busy,false);
});
test('Resume verifies Content-Range and a server ignoring Range safely starts from zero',async t=>{
 let calls=0;const {ai}=fixture(t,async(url,o)=>{calls++;assert.equal(o.headers.Range,'bytes=3-');return {ok:true,status:206,headers:{get:()=>`bytes 0-2/${MODEL.bytes}`},body:(async function*(){yield Buffer.from('WRONG');})()};});fs.writeFileSync(ai.modelPath()+'.part','abc');await assert.rejects(ai.install(),/下载中断/);assert.equal(calls,3);assert.equal(fs.readFileSync(ai.modelPath()+'.part','utf8'),'abc');
 ai.fetch=async()=>({ok:true,status:200,body:(async function*(){yield Buffer.from('reset');})()});await assert.rejects(ai.install(),/下载中断/);assert.equal(fs.readFileSync(ai.modelPath()+'.part','utf8'),'reset');ai.remove();assert(!fs.existsSync(ai.modelPath()+'.part'));
});
test('Empty questions and unavailable model fail without fabricating an answer',async t=>{
 const {ai}=fixture(t,()=>{throw new Error('should not fetch');});await assert.rejects(ai.ask(' '),/请输入/);await assert.rejects(ai.ask('解读偏好'),/先下载/);assert.equal(ai.messages.length,0);assert.equal(ai.busy,false);assert.equal(MODEL.bytes,986048512);
});
test('Explicit numeric changes work even when a small model omits suggestions; discussion stays discussion',async t=>{
 assert.deepEqual(requestedSettings('请把每次推荐设置为30首，探索比例设置为40'),{count:30,exploration:40});
 for(const text of ['不要把每次推荐设置为30首','每次推荐30首怎么样？','如果每次推荐30首','每次推荐20到30首','每次推荐设置为999首'])assert.deepEqual(requestedSettings(text),{});
 const {ai,data}=fixture(t,async()=>({ok:true,json:async()=>({choices:[{message:{content:'{"answer":"已经为您调整了设置。","suggestions":null}'}}]})}));ai.installed=()=>true;ai.start=async()=>{ai.url='http://127.0.0.1:1';};const s=await ai.ask('请把每次推荐设置为30首');assert.equal(s.pending.patch.count,30);assert.equal(data.settings.count,20);assert(s.messages.at(-1).text.includes('后才会保存'));
});
