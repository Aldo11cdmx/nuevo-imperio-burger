const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  printTcp: (data) => ipcRenderer.invoke('print-tcp', data),
})
