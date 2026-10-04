window.decoder.onData(async message=>{
  try {
    const context=new AudioContext();
    const buffer=await context.decodeAudioData(Uint8Array.from(message.bytes).buffer);
    const positions=buffer.duration<32?[0]:[Math.min(20,buffer.duration*.15),buffer.duration*.5,Math.max(0,buffer.duration-25)];
    const clips=[];
    for(const offset of positions){const offline=new OfflineAudioContext(1,160000,16000),source=offline.createBufferSource();source.buffer=buffer;source.connect(offline.destination);source.start(0,offset,10);const clip=await offline.startRendering();clips.push(clip.getChannelData(0).slice());}
    await context.close();window.decoder.reply({id:message.id,clips});
  }catch{window.decoder.reply({id:message.id,error:'无法解码这首歌的音频'});}
});
