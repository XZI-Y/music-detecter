const audio=document.getElementById('audio');let currentId=null,generation=0;
function report(type='state'){window.player.report({type,id:currentId,time:audio.currentTime||0,duration:Number.isFinite(audio.duration)?audio.duration:0,paused:audio.paused});}
window.player.onCommand(async command=>{
  const requestedGeneration=command.type==='load'?generation+1:generation;
  try {
    if(command.type==='load'){const token=++generation;currentId=command.id;audio.src=command.url;audio.volume=command.volume;await audio.play();if(token!==generation)return;report();}
    else if(command.type==='pause')audio.pause();
    else if(command.type==='resume'){await audio.play();report();}
    else if(command.type==='seek')audio.currentTime=command.time;
    else if(command.type==='volume')audio.volume=command.volume;
  }catch{if(requestedGeneration===generation)report('error');}
});
for(const event of ['timeupdate','durationchange','play','pause','seeked','loadedmetadata'])audio.addEventListener(event,()=>report());
audio.addEventListener('ended',()=>report('ended'));audio.addEventListener('error',()=>report('error'));
