const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('player',{onCommand:cb=>ipcRenderer.on('player:command',(_,v)=>cb(v)),report:value=>ipcRenderer.send('player:report',value)});
