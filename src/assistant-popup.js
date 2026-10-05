const $=id=>document.getElementById(id);let state,settingsDirty=false;
function element(tag,cls='',text=''){const e=document.createElement(tag);e.className=cls;e.textContent=text;return e;}
function toast(text){$('toast').textContent=text;$('toast').classList.remove('hidden');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),4500);}
async function request(action,data){const r=await window.music.request(action,data);if(!r.ok)throw new Error(r.error);return r.data;}
async function run(task){try{await task();}catch(e){toast(e.message);}}
function render(){if(!state)return;RadarAppearance.apply(state.settings.appearance);window.renderAssistant?.(state.assistant);}
async function refresh(){state=await request('state');render();}
window.music.onChanged(()=>run(refresh));window.music.onAppearance(value=>RadarAppearance.apply(value));run(refresh);
