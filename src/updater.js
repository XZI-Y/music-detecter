 'use strict';
function configureUpdates({app,settings,notify,disabled=false,updater}){
 const autoUpdater=updater||require('electron-updater').autoUpdater;
 const state={status:'idle',message:'当前版本 '+app.getVersion(),version:app.getVersion(),progress:0,transferred:0,total:0,speed:0,installOnQuit:settings().installOnQuit!==false,downloadMode:'auto'};
 const emit=()=>notify({...state});let checking=false,downloading=false,available=false;
 autoUpdater.setFeedURL({provider:'github',owner:'XZI-Y',repo:'music-detecter',private:false});
 autoUpdater.disableDifferentialDownload=false;autoUpdater.disableWebInstaller=true;
 autoUpdater.autoInstallOnAppQuit=state.installOnQuit;autoUpdater.autoRunAppAfterInstall=true;
 const preferences=()=>{state.installOnQuit=settings().installOnQuit!==false;autoUpdater.autoInstallOnAppQuit=state.installOnQuit;if(state.status==='ready'){if(state.installOnQuit)autoUpdater.addQuitHandler();state.message=state.installOnQuit?'更新已准备好，正常退出雷达时自动安装；可以继续听歌':'更新已准备好，等你选择重启安装';}emit();};
 // Surface differential fallback without exposing network details or credentials.
 autoUpdater.logger={info:message=>{if(/Download block maps/.test(String(message)))state.downloadMode='differential';if(/already been downloaded/i.test(String(message)))state.downloadMode='cached';},warn:()=>{},error:message=>{if(/fallback to full download/i.test(String(message))){state.downloadMode='full';state.message='差量下载暂不可用，正在下载完整更新';emit();}}};
 autoUpdater.on('checking-for-update',()=>{Object.assign(state,{status:'checking',message:'正在检查更新…'});emit();});
 autoUpdater.on('update-available',info=>{available=true;Object.assign(state,{status:'available',version:info.version,progress:0,downloadMode:'auto',message:'发现新版本 '+info.version+' · 下载期间可以继续听歌'});emit();});
 autoUpdater.on('update-not-available',()=>{available=false;Object.assign(state,{status:'current',version:app.getVersion(),message:'已是当前发布的最新版本'});emit();});
 autoUpdater.on('download-progress',info=>{Object.assign(state,{status:'downloading',progress:info.percent,transferred:info.transferred,total:info.total,speed:info.bytesPerSecond,message:'正在后台下载更新 '+Math.round(info.percent)+'% · 可以继续听歌'});emit();});
 autoUpdater.on('update-downloaded',info=>{Object.assign(state,{status:'ready',version:info.version,progress:100});preferences();});
 autoUpdater.on('error',()=>{const stage=downloading||state.status==='downloading'?'download':'check';Object.assign(state,{status:'error',failedAction:stage,message:stage==='download'?'更新下载中断，可重试；已完成的更新会复用缓存':'暂时无法检查更新，请稍后重试'});emit();});
 async function check(){
  if(disabled||!app.isPackaged){Object.assign(state,{status:'development',message:'开发版不执行在线更新'});emit();return {...state};}
  if(checking||downloading||['checking','downloading','ready','installing'].includes(state.status))return {...state};
  checking=true;preferences();autoUpdater.autoDownload=!!settings().autoUpdate;
  try{const result=await autoUpdater.checkForUpdates();if(result?.downloadPromise){downloading=true;result.downloadPromise.catch(()=>{}).finally(()=>{downloading=false;});}}catch{}finally{checking=false;}
  return {...state};
 }
 async function download(){
  if(disabled||!app.isPackaged)throw new Error('开发版不执行在线更新');
  if(downloading)return {...state};if(!available||!['available','error'].includes(state.status))throw new Error('还没有可下载的新版本');
  downloading=true;Object.assign(state,{status:'downloading',message:'正在准备后台下载…',progress:0});emit();
  try{await autoUpdater.downloadUpdate();}catch{if(state.status!=='error'){Object.assign(state,{status:'error',failedAction:'download',message:'更新下载中断，请重试'});emit();}}finally{downloading=false;}return {...state};
 }
 return {snapshot:()=>({...state}),check,download,preferences,install:()=>{if(state.status!=='ready')throw new Error('更新尚未下载完成');Object.assign(state,{status:'installing',message:'正在退出并安装更新…'});emit();autoUpdater.quitAndInstall(true,true);}};
}
module.exports={configureUpdates};
