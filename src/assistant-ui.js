'use strict';
(function(){
 let current,signature='',scrollRequested=false;
 function readable(value){return typeof value==='boolean'?(value?'开启':'关闭'):String(value);}
 window.renderAssistant=function(value){
  if(!value)return;current=value;
  const working=value.busy,status=value.error||(value.phase==='downloading'?'正在下载模型 · '+value.progress+'%':value.phase==='starting'?'正在启动本地 AI…':value.phase==='thinking'?'正在思考…':value.installed?'模型已就绪 · 在你的电脑上运行':'首次使用需要下载约 1 GB 的模型，无需账号或密钥。');
  $('ai-status').textContent=status;$('ai-model-title').textContent=value.installed?'免费本地 AI · '+value.model:'免费本地 AI';
  $('ai-install').textContent=value.progress>0?'继续下载免费模型':'下载免费模型';$('ai-install').classList.toggle('hidden',value.installed||working);$('ai-remove').classList.toggle('hidden',(!value.installed&&!value.progress)||working);$('ai-stop').classList.toggle('hidden',!working);$('ai-stop').textContent=value.phase==='downloading'?'取消下载':'停止回答';
  $('ai-download').classList.toggle('hidden',value.phase!=='downloading');$('ai-download').value=Number.isFinite(value.progress)?value.progress:0;
  $('ai-send').disabled=working||!value.installed;$('ai-clear').disabled=working;$('ai-question').disabled=working;document.querySelectorAll('.ai-prompts button').forEach(b=>{b.disabled=working||!value.installed;});
  const next=JSON.stringify(value.messages);if(next!==signature){signature=next;const box=$('ai-messages');box.replaceChildren();
   if(!value.messages.length){const empty=element('div','ai-empty','✧');empty.append(element('h2','','从你的音乐偏好开始'),element('p','muted','分析歌单后，可以让我解读你的口味。'));box.append(empty);}
   for(const m of value.messages){const item=element('article','ai-message '+(m.role==='user'?'from-user':'from-assistant'));item.append(element('strong','',m.role==='user'?'你':'雷达助手'),element('div','ai-text',m.text));box.append(item);}
   if(scrollRequested){box.scrollTop=box.scrollHeight;scrollRequested=false;}
  }
  const pending=$('ai-suggestions');pending.replaceChildren();pending.classList.toggle('hidden',!value.pending);
  if(value.pending){pending.append(element('h3','','建议调整'));const rows=element('div','ai-changes');for(const change of value.pending.changes){const row=element('div');row.append(element('span','',change.label),element('span','',readable(change.before)+' → '+readable(change.after)));rows.append(row);}pending.append(rows,element('p','muted','应用后在下一次推荐时生效。'));
   const buttons=element('div','buttons'),apply=element('button','primary','应用这些设置'),dismiss=element('button','text-button','暂不调整');apply.onclick=()=>run(async()=>{if(settingsDirty){toast("请先保存设置中的未保存修改");return;}apply.disabled=true;try{state=await request('assistantApply',{id:value.pending.id});settingsDirty=false;render();toast('建议已应用，下次推荐时生效');}finally{apply.disabled=false;}});dismiss.onclick=()=>run(async()=>window.renderAssistant(await request('assistantDismiss')));buttons.append(apply,dismiss);pending.append(buttons);
  }
 };
 $('ai-install').onclick=()=>run(async()=>window.renderAssistant(await request('assistantInstall')));
 $('ai-remove').onclick=()=>run(async()=>window.renderAssistant(await request('assistantRemove')));
 $('ai-stop').onclick=()=>run(()=>request('assistantCancel'));
 $('ai-clear').onclick=()=>run(async()=>window.renderAssistant(await request('assistantClear')));
 $('ai-form').onsubmit=e=>{e.preventDefault();const text=$('ai-question').value.trim();if(!text||current?.busy)return;scrollRequested=true;run(async()=>{await request('assistantAsk',{text});$('ai-question').value='';});};
 $('ai-question').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('ai-form').requestSubmit();}};
 document.querySelectorAll('.ai-prompts button').forEach(b=>{b.onclick=()=>{$('ai-question').value=b.dataset.question;$('ai-form').requestSubmit();};});
 window.music.onAssistant(window.renderAssistant);if(state?.assistant)window.renderAssistant(state.assistant);
})();
