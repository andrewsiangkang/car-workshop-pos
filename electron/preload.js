const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workshopBackup", {
  get: () => ipcRenderer.invoke("backup:get"),
  set: (patch) => ipcRenderer.invoke("backup:set", patch),
  chooseDir: () => ipcRenderer.invoke("backup:choose-dir"),
  runNow: () => ipcRenderer.invoke("backup:run-now"),
  openFolder: () => ipcRenderer.invoke("backup:open-folder"),
  restore: (name) => ipcRenderer.invoke("backup:restore", name),
});

contextBridge.exposeInMainWorld("workshopUpdate", {
  check: () => ipcRenderer.invoke("update:check"),
  open: (url) => ipcRenderer.invoke("update:open", url),
});
