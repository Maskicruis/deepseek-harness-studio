const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('harnessStudio', {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximized: (callback) => subscribe('window:maximized', callback),
  },
  runtime: {
    status: () => ipcRenderer.invoke('runtime:status'),
    start: () => ipcRenderer.invoke('runtime:start'),
    restart: () => ipcRenderer.invoke('runtime:restart'),
    paths: () => ipcRenderer.invoke('runtime:paths'),
    openUrl: (url) => ipcRenderer.invoke('runtime:open-url', url),
    openPath: (targetPath) => ipcRenderer.invoke('runtime:open-path', targetPath),
    onStatus: (callback) => subscribe('runtime:status-changed', callback),
    onLog: (callback) => subscribe('runtime:log', callback),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    chooseWorkspace: () => ipcRenderer.invoke('settings:choose-workspace'),
  },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (callback) => subscribe('updates:status-changed', callback),
  },
  workspace: {
    onDetected: (callback) => subscribe('workspace:path-detected', callback),
  },
  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    chooseLocal: () => ipcRenderer.invoke('plugins:choose-local'),
    install: (source) => ipcRenderer.invoke('plugins:install', source),
    remove: (name) => ipcRenderer.invoke('plugins:remove', name),
    toggle: (name, enabled) => ipcRenderer.invoke('plugins:toggle', { name, enabled }),
    openProfile: () => ipcRenderer.invoke('plugins:open-profile'),
    onBusy: (callback) => subscribe('plugins:busy', callback),
    onLog: (callback) => subscribe('plugins:log', callback),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    chooseLocal: () => ipcRenderer.invoke('skills:choose-local'),
    install: (source) => ipcRenderer.invoke('skills:install', source),
    remove: (name) => ipcRenderer.invoke('skills:remove', name),
    openRoot: () => ipcRenderer.invoke('skills:open-root'),
  },
})
