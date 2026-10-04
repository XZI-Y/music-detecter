'use strict';
function configureUpdates({app,settings,notify,disabled=false}){
  const {autoUpdater}=require('electron-updater');
  const state={status:'idle',message:'当前版本 '+app.getVersion(),version:app.getVersion(),progress:0};
  const emit=()=>notify({...state});
  autoUpdater.setFeedURL({provider:'github',owner:'XZI-Y',repo:'music-detecter',private:false});
  autoUpdater.autoInstallOnAppQuit=false;
  autoUpdater.on('checking-for-update',()=>{Object.assign(state,{status:'checking',message:'正在检查更新…'});emit();});
  autoUpdater.on('update-available',info=>{Object.assign(state,{status:'available',version:info.version,message:'发现新版本 '+info.version});emit();});
  autoUpdater.on('update-not-available',()=>{Object.assign(state,{status:'current',message:'已是当前发布的最新版本'});emit();});
  autoUpdater.on('download-progress',info=>{Object.assign(state,{status:'downloading',progress:info.percent,message:'正在下载更新 '+Math.round(info.percent)+'%'});emit();});
  autoUpdater.on('update-downloaded',info=>{Object.assign(state,{status:'ready',version:info.version,message:'更新已下载，重启即可安装'});emit();});
  autoUpdater.on('error',()=>{Object.assign(state,{status:'error',message:'暂时无法检查更新；请确认网络和仓库已有正式发布版本'});emit();});
  async function check(){
    if(disabled||!app.isPackaged){Object.assign(state,{status:'development',message:'开发版不执行在线更新'});emit();return {...state};}
    if(['checking','downloading','ready'].includes(state.status))return {...state};
    autoUpdater.autoDownload=!!settings().autoUpdate;
    try{await autoUpdater.checkForUpdates();}catch{}
    return {...state};
  }
  return {snapshot:()=>({...state}),check,download:async()=>{if(state.status!=='available')throw new Error('还没有可下载的新版本');await autoUpdater.downloadUpdate();return {...state};},install:()=>{if(state.status!=='ready')throw new Error('更新尚未下载完成');autoUpdater.quitAndInstall(false,true);}};
}
module.exports={configureUpdates};
