/**
 * The preload script runs before `index.html` is loaded
 * in the renderer. It has access to web APIs as well as
 * Electron's renderer process modules and some polyfilled
 * Node.js functions.
 *
 * https://www.electronjs.org/docs/latest/tutorial/sandbox
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  login: (credentials) => ipcRenderer.invoke('login', credentials),
  logout: () => ipcRenderer.invoke('logout'),
  checkConnection: () => ipcRenderer.invoke('check-connection'),
  saveCredentials: (credentials) => ipcRenderer.invoke('save-credentials', credentials),
  loadCredentials: () => ipcRenderer.invoke('load-credentials'),
  onStatusChange: (callback) => ipcRenderer.on('status-change', callback),
  onProgressUpdate: (callback) => ipcRenderer.on('progress-update', callback),
  onLoginResult: (callback) => ipcRenderer.on('login-result', callback),
  onLogoutResult: (callback) => ipcRenderer.on('logout-result', callback),
  onConnectionCheckResult: (callback) => ipcRenderer.on('connection-check-result', callback),
  onConnectionStatusUpdate: (callback) => ipcRenderer.on('connection-status-update', callback),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  getNetworkInfo: () => ipcRenderer.invoke('get-network-info'),
  testProgress: () => ipcRenderer.invoke('test-progress'),
  cancelOperation: () => ipcRenderer.invoke('cancel-operation')
})

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})
