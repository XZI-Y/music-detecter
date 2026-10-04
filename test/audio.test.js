const test=require('node:test'),assert=require('node:assert/strict');const {signalFeatures,instrumentFeatures,audioSimilarity}=require('../src/audio-features');
test('纯音的实际频谱亮度准确，静音不捏造节奏',()=>{const pure=Float32Array.from({length:160000},(_,i)=>.1*Math.sin(2*Math.PI*440*i/16000));const f=signalFeatures([pure]);assert.ok(Math.abs(f.brightness-440)<20);assert.equal(f.bpm,null);assert.equal(signalFeatures([new Float32Array(160000)]).bpm,null);});
test('乐器识别只保留模型达到阈值的乐器，不把关键词当音频',()=>{const f=instrumentFeatures([[{label:'Piano',score:.7},{label:'Guitar',score:.01},{label:'Music',score:.9}]]);assert.deepEqual(f.instruments.map(i=>i.name),['钢琴']);assert.deepEqual(instrumentFeatures([]).instruments,[]);});
test('缺失音频不返回虚构相似度',()=>{assert.equal(audioSimilarity({},{}).rhythm,null);});
