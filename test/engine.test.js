const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, rankSong, recommend, lexicalFeatures, dateKey } = require('../src/engine');
const { defaults, Store } = require('../src/store');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function song(id, artist = id, tags = []) { return normalize({ id, name: '歌曲' + id, ar: [{ id: artist, name: '歌手' + artist }], al: { id: id + 100, name: '专辑' }, dt: 200000 }, tags); }
function data() { const d = defaults(); d.library = [{ ...song(1, 10, ['爵士']), liked: true }]; d.likedIds = [1]; return d; }
test('歌手不再加分，音乐特征相近优先', () => {
  const seed = song(1, 10), a = song(2, 10), b = song(3, 20);
  assert.equal(rankSong(a, [seed]).score,rankSong(b, [seed]).score);
  assert.equal(rankSong(a, [seed]).breakdown.artist, 0);
  b.tags = ['爵士']; seed.tags = ['爵士']; b.sources = [{ type: 'similar', seedId: 1 }];
  assert.ok(rankSong(b, [seed]).score > rankSong(a, [seed]).score);
});
test('排除全部喜欢列表、否定反馈、已屏蔽歌手、近期推荐和不可用歌曲', () => {
  const d = data(); d.likedIds.push(2); d.feedback[3] = { value: 'dislike' }; d.blockedArtists.push(40); d.history = [{ date: '2026-10-03', songs: [song(5)] }];
  const candidates = [song(2), song(3), song(4, 40), song(5), { ...song(6), unavailable: true }, song(7)];
  assert.deepEqual(recommend(candidates, d, '2026-10-04').map(s => s.id), [7]);
});
test('新歌手模式每位歌手一首，重复版本不凑数', () => {
  const d = data(); const candidates = Array.from({ length: 15 }, (_, i) => song(i + 20, 77));
  assert.equal(recommend(candidates, d, '2026-10-04').length, 1);
  const dup = [song(20, 77), { ...song(21, 77), name: '歌曲20 (Live)' }, song(22, 78)];
  assert.equal(recommend(dup, d, '2026-10-04').length, 2);
});
test('默认不推荐来源歌单中的同歌手作品，可主动放宽',()=>{
  const d=data(),candidate=song(22,10,['爵士']);assert.equal(recommend([candidate],d,'2026-10-04').length,0);
  d.settings.avoidKnownArtists=false;assert.equal(recommend([candidate],d,'2026-10-04').length,1);
});
test('可靠乐器特征会影响排序，缺失乐器时不猜测',()=>{
  const seed=song(1),a=song(2),b=song(3);seed.features.audio={instruments:[{name:'钢琴',confidence:.8}]};a.features.audio={instruments:[{name:'钢琴',confidence:.7}]};b.features.audio={instruments:[{name:'架子鼓',confidence:.8}]};
  assert.ok(rankSong(a,[seed]).score>rankSong(b,[seed]).score);assert.equal(rankSong(song(4),[seed]).breakdown.instruments,null);
});
test('替换歌曲时也遵守已有歌单的歌手上限', () => {
  const d = data(); d.settings.count = 1;
  const result = recommend([song(30, 77), song(31, 78)], d, '2026-10-04', [], [song(20, 77), song(21, 77)]);
  assert.deepEqual(result.map(s => s.id), [31]);
});
test('相同日期和数据生成稳定结果，多种口味能分别匹配', () => {
  const d = data(); d.library.push(song(8, 80, ['摇滚']));
  const candidates = Array.from({ length: 50 }, (_, i) => ({ ...song(i + 30, i + 90, [i % 2 ? '摇滚' : '爵士']), sources: [{ type: 'similar', seedId: i % 2 ? 8 : 1 }] }));
  const first = recommend(candidates, d, '2026-10-04');
  assert.deepEqual(first.map(s => s.id), recommend(candidates, d, '2026-10-04').map(s => s.id));
  assert.ok(first.some(s => s.seedId === 8) && first.some(s => s.seedId === 1));
});
test('喜欢反馈提升相应关联，撤销后恢复', () => {
  const seed = { ...song(1), liked: true }, candidate = { ...song(2), sources: [{ type: 'similar', seedId: 1 }] };
  assert.ok(rankSong(candidate, [{ ...seed, localLiked: true }]).score > rankSong(candidate, [seed]).score);
});
test('歌词关键词需要两种命中，不凭标题编造情绪，缺失歌词不猜语言', () => {
  assert.deepEqual(lexicalFeatures('').mood, []); assert.equal(lexicalFeatures('').language, null);
  assert.deepEqual(lexicalFeatures('爱你').theme, []);
  assert.deepEqual(lexicalFeatures('这是爱情 我爱你').theme, ['爱情']);
  assert.deepEqual(lexicalFeatures('作词：孤独 眼泪\n你好').mood, []);
});
test('北京时间跨日正确，旧历史不永久排除', () => {
  assert.equal(dateKey(new Date('2026-10-03T17:00:00Z')), '2026-10-04');
  const d = data(); d.history = [{ date: '2026-09-01', songs: [song(22)] }]; assert.equal(recommend([song(22)], d, '2026-10-04').length, 1);
});
test('存储原子写入且损坏数据保留备份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-store-test-'));
  try {
    const store = new Store(dir); store.data.feedback[1] = { value: 'like' }; store.save();
    assert.equal(new Store(dir).data.feedback[1].value, 'like');
    fs.writeFileSync(path.join(dir, 'library.json'), '{broken');
    const recovered = new Store(dir); assert.ok(recovered.data.warnings.length); assert.ok(fs.readdirSync(dir).some(n => n.includes('.damaged-')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
