const $=id=>document.getElementById(id);let state,player,expanded=false,collapseTimer,dragging=false;
async function request(action,data){const r=await window.music.request(action,data);if(!r.ok){$('message').textContent=r.error;throw new Error(r.error);}return r.data;}
function time(seconds){return Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');}
function render(p){player=p;$('title').textContent=p.song?.name||'选择一首歌开始播放';$('artist').textContent=p.song?.artists?.map(a=>a.name).join(' / ')||'你的每日音乐';$('toggle').textContent=p.paused?'▶':'Ⅱ';$('bubble').classList.toggle('playing',!p.paused);$('elapsed').textContent=time(p.time);$('duration').textContent=time(p.duration);if(!dragging){$('seek').max=p.duration||1;$('seek').value=p.time;}$('mode').textContent=p.mode==='shuffle'?'⤨':'→';$('mode').title=p.mode==='shuffle'?'随机播放':'顺序播放';$('message').textContent=p.error|| (p.trial?'当前音源为试听':'');const saved=!!state?.favorites?.[state.settings.favoritePlaylist]?.includes(p.song?.id);$('heart').textContent=saved?'♥':'♡';$('heart').classList.toggle('favorite',saved);}
async function refresh(){state=await request('state');if(state.player)render(state.player);$('suggestions').replaceChildren();const today=state.history.find(h=>h.date===state.today);for(const song of (today?.songs||[]).filter(s=>s.id!==player?.song?.id).slice(0,3)){const button=document.createElement('button');button.textContent='▶ '+song.name;button.onclick=()=>request('playerPlay',{id:song.id,date:today.date}).catch(()=>{});$('suggestions').append(button);}}
document.body.onmouseenter=()=>{clearTimeout(collapseTimer);if(!expanded){expanded=true;document.body.classList.add('expanded');request('bubbleExpand',{expanded:true}).catch(()=>{});}};
document.body.onmouseleave=()=>{if(dragging)return;collapseTimer=setTimeout(()=>{expanded=false;document.body.classList.remove('expanded');request('bubbleExpand',{expanded:false}).catch(()=>{});},650);};
for(const [id,type] of [['toggle','toggle'],['previous','previous'],['next','next']])$(id).onclick=()=>request('playerCommand',{type}).catch(()=>{});
$('mode').onclick=()=>request('playerCommand',{type:'mode',value:player?.mode==='shuffle'?'sequence':'shuffle'}).catch(()=>{});
$('heart').onclick=async()=>{if(!player?.song)return;$('heart').disabled=true;try{await request('favorite',{id:player.song.id,add:!state?.favorites?.[state.settings.favoritePlaylist]?.includes(player.song.id)});await refresh();}catch{}finally{$('heart').disabled=false;}};
$('seek').onpointerdown=()=>{dragging=true;};$('seek').onchange=()=>{request('playerCommand',{type:'seek',value:Number($('seek').value)}).catch(()=>{});dragging=false;};$('seek').onpointerup=()=>{dragging=false;};
$('open').onclick=()=>request('openWindow').catch(()=>{});
window.music.onPlayer(render);window.music.onChanged(()=>refresh().catch(()=>{}));refresh().catch(()=>{});

window.__previewFixture=value=>{state=value;render(value.player);document.body.classList.add("expanded");};
