const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store');
test('覆盖升级保留账号与历史，重新要求明确选择分析来源',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-upgrade-'));
  try{
    const previous={version:1,profile:{id:42,name:'测试账号'},history:[{date:'2026-10-04',songs:[{id:1}]}],settings:{selected:[10],count:30},feedback:{1:{value:'like'}}};
    fs.writeFileSync(path.join(dir,'library.json'),JSON.stringify(previous));
    const store=new Store(dir);assert.deepEqual(store.data.profile,previous.profile);assert.deepEqual(store.data.history,previous.history);assert.equal(store.data.settings.sourceConfirmed,false);assert.equal(store.data.settings.analysisStarted,false);assert.deepEqual(store.data.settings.selected,[]);assert.equal(store.data.settings.count,30);assert.equal(store.data.feedback[1].value,'like');store.data.settings.selected=[20];store.data.settings.sourceConfirmed=true;store.save();assert.deepEqual(new Store(dir).data.settings.selected,[20]);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
