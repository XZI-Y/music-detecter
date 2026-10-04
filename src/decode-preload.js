const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('decoder',{onData:cb=>ipcRenderer.on('audio:decode',(_,v)=>cb(v)),reply:value=>ipcRenderer.send('audio:decoded',value)});
