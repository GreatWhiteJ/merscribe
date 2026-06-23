const { contextBridge, ipcRenderer } = require('electron')

// Exposes a minimal, safe file API to the renderer for silent auto-save.
contextBridge.exposeInMainWorld('desktop', {
  getSavePath: () => ipcRenderer.invoke('get-save-path'),
  chooseSavePath: () => ipcRenderer.invoke('choose-save-path'),
  loadSession: () => ipcRenderer.invoke('load-session'),
  loadFile: () => ipcRenderer.invoke('load-file'),
  save: (md, state) => ipcRenderer.invoke('save', md, state),
  // Subscribe to external .md changes; returns an unsubscribe function.
  onFileChanged: (cb) => {
    const handler = (_e, content) => cb(content)
    ipcRenderer.on('file-changed', handler)
    return () => ipcRenderer.removeListener('file-changed', handler)
  },
})
