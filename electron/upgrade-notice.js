// What the desktop app tells the boss after the server's automatic database upgrade
// (src/lib/schema-upgrade.ts writes these files in the data folder):
// - upgrade-error.txt     the upgrade failed (nothing was changed; it is tried again next time)
// - upgrade-warnings.txt  the upgrade worked, but a unique document-number index was skipped
//                         because old records hold a duplicate number (shown once per content,
//                         as a calm notice, not as an error)
// No Electron imports, so tests can require it directly.
// 【中文】数据库自动升级后的提示：upgrade-error.txt = 升级失败（资料没改，下次启动会再试）；
// upgrade-warnings.txt = 升级成功，但旧资料有重复单号所以没建立「单号不重复」索引（同样内容只提示一次）。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * @returns {{ errorFile: string | null, warnings: { file: string, lines: string[], key: string } | null }}
 */
function readUpgradeNotices(dataDir) {
  const errorFile = path.join(dataDir, "upgrade-error.txt");
  const warnFile = path.join(dataDir, "upgrade-warnings.txt");
  let warnings = null;
  try {
    // First line: when it was written (changes at every start). The rest: the problems.
    const lines = fs.readFileSync(warnFile, "utf8").split(/\r?\n/).slice(1).map((l) => l.trim()).filter(Boolean);
    if (lines.length) {
      const key = crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
      let seen = "";
      try { seen = fs.readFileSync(seenFile(dataDir), "utf8").trim(); } catch {}
      if (seen !== key) warnings = { file: warnFile, lines, key };
    }
  } catch {}
  return { errorFile: fs.existsSync(errorFile) ? errorFile : null, warnings };
}

function seenFile(dataDir) {
  return path.join(dataDir, "upgrade-warnings.seen");
}

/** The notice for these warnings was shown: do not show the same ones again. */
function markWarningsShown(dataDir, key) {
  try { fs.writeFileSync(seenFile(dataDir), key + "\n"); } catch {}
}

module.exports = { readUpgradeNotices, markWarningsShown };
