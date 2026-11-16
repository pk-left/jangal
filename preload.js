const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jangal', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  saveSync: (data) => ipcRenderer.sendSync('data:saveSync', data),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  progress: (value) => ipcRenderer.send('progress', value),
  setMini: (on) => ipcRenderer.invoke('win:mini', on),
  setChrome: (colors) => ipcRenderer.send('win:chrome', colors),
  exportFile: (content, name, ext) => ipcRenderer.invoke('file:export', { content, name, ext }),
  importFile: () => ipcRenderer.invoke('file:import'),
  onSuspend: (cb) => ipcRenderer.on('system:suspend', () => cb()),
});
