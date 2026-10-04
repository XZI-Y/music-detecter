const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('music', {
  request: (action, data) => ipcRenderer.invoke('music:request', action, data),
  onProgress: callback => { ipcRenderer.on('music:progress', (_, value) => callback(value)); },
  onChanged: callback => { ipcRenderer.on('music:changed', () => callback()); }
  ,onPlayer: callback => { ipcRenderer.on('music:player', (_, value) => callback(value)); }
  ,onUpdate: callback => { ipcRenderer.on('music:update', (_, value) => callback(value)); }
});
