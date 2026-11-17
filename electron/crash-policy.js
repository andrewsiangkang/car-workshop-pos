// When to restart the embedded server after it stops unexpectedly. Pure, for unit tests.
// Waits longer after each crash (1 s, 5 s, 15 s, then 60 s) and gives up after
// 5 crashes within 10 minutes, so a broken database or disk does not loop forever.
// 【中文】内部服务器崩溃后的重启策略：间隔逐步加长（1 秒、5 秒、15 秒、60 秒）；10 分钟内崩溃 5 次就停止并提示。

const BACKOFF_MS = [1000, 5000, 15000, 60000];
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CRASHES = 5;

/**
 * @param {number[]} history crash times (ms) seen so far
 * @param {number} now
 * @returns {{ giveUp: boolean, delayMs: number, recent: number[] }} `recent` is the new history to keep
 */
function onCrash(history, now) {
  const recent = (history || []).filter((t) => now - t < WINDOW_MS).concat(now);
  if (recent.length >= MAX_CRASHES) return { giveUp: true, delayMs: 0, recent };
  return { giveUp: false, delayMs: BACKOFF_MS[Math.min(recent.length, BACKOFF_MS.length) - 1], recent };
}

module.exports = { onCrash, BACKOFF_MS, WINDOW_MS, MAX_CRASHES };
