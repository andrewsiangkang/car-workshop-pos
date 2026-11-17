// What to do when the boss opens the app while it is already running (single instance).
// After the window is closed the app keeps running for up to 60 s to finish the final backup;
// the old window object is destroyed then, and touching it would crash the main process.
// No Electron imports, so tests can require it directly.
// 【中文】程序已在运行时再次打开：窗口还在就调到前面；窗口已关闭、正在做最后一次备份时，等备份完成后重新打开程序。

/**
 * @param win the main BrowserWindow, or null
 * @param quitStage 0 = running, 1 = final backup in progress, 2 = exiting
 * @returns "focused" | "reopen-after-quit" | "ignored"
 */
function onSecondInstance(win, quitStage) {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    return "focused";
  }
  // The new copy has already quit; start the app again once this one has finished closing.
  return quitStage === 1 ? "reopen-after-quit" : "ignored";
}

module.exports = { onSecondInstance };
