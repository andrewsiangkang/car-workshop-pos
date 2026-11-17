// Preload of the backup-password window used by the emergency restore (emergency-restore.js).
// The page itself has no script: this wires the form and sends the answer to the main process,
// which accepts it only from this window. Sandboxed: only `electron` can be required here.
// 【中文】紧急还原时输入备份密码的小窗口：这里处理表单并把密码交给主进程（主进程只接受这个窗口发来的答案）。
const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("f");
  const pw = document.getElementById("pw");
  const file = document.getElementById("file");
  const name = new URLSearchParams(window.location.search).get("file");
  if (file && name) file.textContent = name;
  let sent = false;
  const send = (password) => {
    if (sent) return;
    sent = true;
    ipcRenderer.send("emergency-restore:password", password);
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (pw.value) send(pw.value);
  });
  document.getElementById("cancel").addEventListener("click", () => send(null));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") send(null);
  });
  pw.focus();
});
