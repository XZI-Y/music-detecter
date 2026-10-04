const test = require('node:test');
const assert = require('node:assert/strict');
const { Connector } = require('../src/connector');
const { defaults } = require('../src/store');
test('扫码凭据不返回给二维码显示逻辑', async () => {
  const c = new Connector(() => '', () => {}); c.api = { login_qr_key: async () => ({ body: { code: 200, data: { unikey: 'fake-key' } } }), login_qr_create: async () => ({ body: { code: 200, data: { qrimg: 'data:image/png;base64,AA' } } }) };
  assert.equal((await c.qr()).image, 'data:image/png;base64,AA');
});
test('接口报错不泄露 cookie 或请求详情', async () => {
  const c = new Connector(() => 'MUSIC_U=SECRET', () => {}); c.api = { user_account: async () => { throw { message: 'headers MUSIC_U=SECRET', body: { code: 301 } }; } };
  await assert.rejects(c.account(), e => e.message.includes('登录已失效') && !e.message.includes('SECRET'));
});
test('同步失败不修改原有数据', async () => {
  const c = new Connector(() => '', () => {}), d = defaults(); d.library = [{ id: 123 }];
  d.settings.sourceConfirmed=true;d.settings.selected=[10];const before = JSON.stringify(d); c.account = async () => ({ id: 1 }); c.call = async () => ({ code: 200 });
  await assert.rejects(c.sync(d), /喜欢列表/); assert.equal(JSON.stringify(d), before);
});
test('没有确认分析来源时不会请求网易云',async()=>{
  const c=new Connector(()=>'',()=>{}),d=defaults();let calls=0;c.call=async()=>{calls++;};await assert.rejects(c.sync(d),/选择分析歌单/);assert.equal(calls,0);
});
test('完整读取超过旧限制的歌单且复用缓存',async()=>{
  const c=new Connector(()=>'',()=>{});const ids=Array.from({length:620},(_,i)=>i+1);let requested=0;
  c.call=async()=>({playlist:{trackIds:ids.map(id=>({id})),tags:['爵士'],tracks:[]}});
  c.details=async values=>{requested+=values.length;return values.map(id=>({id,name:'歌曲'+id,artists:[],tags:[],features:{}}));};
  const first=await c.fullPlaylist(1);assert.equal(first.songs.length,620);const second=await c.fullPlaylist(1,first.songs);assert.equal(second.songs.length,620);assert.equal(requested,620);
});
test('收藏嵌套响应必须真正成功，失败不伪装成功',async()=>{
  const c=new Connector(()=>'',()=>{});c.api={playlist_tracks:async()=>({status:200,body:{status:200,body:{code:200}}})};assert.equal(await c.favorite(1,2),true);
  c.api.playlist_tracks=async()=>({status:200,body:{code:500}});await assert.rejects(c.favorite(1,2));
});
test('候选主接口不可用时保留其他来源并给出提示', async () => {
  const c = new Connector(() => '', () => {}), d = defaults(); d.library = [{ id: 1, name: '种子', artists: [], tags: [], features: {} }];
  c.call = async name => {
    if (name === 'simi_song' || name === 'simi_playlist') throw new Error('unavailable');
    if (name === 'recommend_songs') return { data: { dailySongs: [{ id: 2, name: '候选', ar: [] }] } };
    if (name === 'lyric') return {};
    return {};
  };
  c.details = async () => [];
  const result = await c.candidates(d); assert.equal(result.candidates[0].id, 2); assert.ok(result.warnings.some(w => w.includes('关联')));
});
