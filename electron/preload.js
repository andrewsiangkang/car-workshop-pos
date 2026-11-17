const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workshopBackup", {
  get: () => ipcRenderer.invoke("backup:get"),
  set: (patch) => ipcRenderer.invoke("backup:set", patch),
  chooseDir: () => ipcRenderer.invoke("backup:choose-dir"),
  runNow: () => ipcRenderer.invoke("backup:run-now"),
  openFolder: () => ipcRenderer.invoke("backup:open-folder"),
  restore: (name) => ipcRenderer.invoke("backup:restore", name),
  // Backup password for the encrypted USB / cloud copies (never stored, only its derived key).
  setPassword: (password) => ipcRenderer.invoke("backup:set-password", password),
  removePassword: () => ipcRenderer.invoke("backup:remove-password"),
  deletePlainExtra: () => ipcRenderer.invoke("backup:delete-plain-extra"),
  // "Restore from a backup file…": the file is chosen in a native dialog; the page only gets an id.
  pickRestoreFile: () => ipcRenderer.invoke("backup:pick-restore-file"),
  restoreFile: (id, password) => ipcRenderer.invoke("backup:restore-file", { id, password }),
});

// After a native alert / confirm, Windows can leave the page without keyboard focus (text boxes cannot be typed in).
contextBridge.exposeInMainWorld("workshopWindow", {
  refocus: () => ipcRenderer.invoke("window:refocus"),
});

// Phone / tablet (LAN) access switch: Settings → Phone / Tablet.
contextBridge.exposeInMainWorld("workshopNetwork", {
  get: () => ipcRenderer.invoke("network:get"),
  set: (enabled) => ipcRenderer.invoke("network:set", enabled),
});

contextBridge.exposeInMainWorld("workshopUpdate", {
  check: () => ipcRenderer.invoke("update:check"),
  // Downloads the installer, checks its SHA-256 and installs it; every step is confirmed in a native dialog.
  install: () => ipcRenderer.invoke("update:install"),
  // Opens the release page in the browser (never the installer itself).
  open: (url) => ipcRenderer.invoke("update:open", url),
});
