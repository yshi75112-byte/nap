const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("desktopAPI", {
  getInitialProject: () => ipcRenderer.invoke("project:get-initial"),
  newProject: () => ipcRenderer.invoke("project:new"),
  openProject: () => ipcRenderer.invoke("project:open"),
  saveProject: (payload) => ipcRenderer.invoke("project:save", payload),
  saveProjectAs: (payload) => ipcRenderer.invoke("project:save-as", payload),
  updateProject: (payload) => ipcRenderer.send("project:update-state", payload),
  exportPng: (payload) => ipcRenderer.invoke("project:export-png", payload),
  onCommand: (callback) => subscribe("project:command", callback),
  onProjectSaved: (callback) => subscribe("project:saved", callback),
  onProjectError: (callback) => subscribe("project:error", callback)
});
