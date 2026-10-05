'use strict';
function count(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>100)throw new Error('推荐数量请输入 1–100 的整数');return n;}
async function playerCommand(player,data,type,value){
 if(type==='toggle'&&!player.snapshot().song){
  const date=require('./engine').dateKey(),history=data.history.find(h=>h.date===date&&h.songs.length)||data.history.find(h=>h.songs.length);
  if(!history)throw new Error('还没有可播放的歌单，请先开始分析或生成推荐');
  return player.play(history.songs,history.songs[0].id);
 }
 return player.command(type,value);
}
module.exports={count,playerCommand};
