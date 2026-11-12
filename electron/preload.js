const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workshopBackup", {
  get: () => ipcRenderer.invoke("backup:get"),
  set: (patch) => ipcRenderer.invoke("backup:set", patch),
  chooseDir: () => ipcRenderer.invoke("backup:choose-dir"),
  runNow: () => ipcRenderer.invoke("backup:run-now"),
  openFolder: () => ipcRenderer.invoke("backup:open-folder"),
  restore: (name) => ipcRenderer.invoke("backup:restore", name),
});

// After a native alert / confirm, Windows can leave the page without keyboard focus (text boxes cannot be typed in).
contextBridge.exposeInMainWorld("workshopWindow", {
  refocus: () => ipcRenderer.invoke("window:refocus"),
});

contextBridge.exposeInMainWorld("workshopUpdate", {
  check: () => ipcRenderer.invoke("update:check"),
  open: (url) => ipcRenderer.invoke("update:open", url),
});
