// Checks a database file before an emergency restore, when the embedded server cannot start.
// Runs in its own Node process (the desktop app starts it with ELECTRON_RUN_AS_NODE, like the
// server), so a damaged file or a crash in the database engine never takes the app down:
//     <electron or node> db-check.js <file> <serverDir>
// It uses the Prisma client that ships with the server (<serverDir>/node_modules) and runs the
// same checks as /api/internal/backup "verify": PRAGMA integrity_check, the WorkOrder and User
// tables exist, plus a short summary. Prints one JSON line and exits 0 when the file is good.
// No Electron imports and no other files of this folder, so it also runs under plain Node (tests).
// 【中文】紧急还原前检查备份文件（服务器无法启动时）：在独立进程里用服务器自带的 Prisma 做完整性检查，
// 确认是本程序的数据库；输出一行 JSON，文件正常时退出码为 0。
const path = require("path");
const { createRequire } = require("module");

function print(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function check(file, serverDir) {
  let PrismaClient;
  try {
    ({ PrismaClient } = createRequire(path.join(serverDir, "server.js"))("@prisma/client"));
  } catch (e) {
    return { ok: false, error: "ENGINE_MISSING: " + String((e && e.message) || e).slice(0, 200) };
  }
  const db = new PrismaClient({ datasourceUrl: "file:" + path.resolve(file).replace(/\\/g, "/") });
  try {
    // integrity_check (not quick_check): it also checks that every index matches its table.
    const rows = await db.$queryRawUnsafe("PRAGMA integrity_check");
    const result = rows.map((r) => String(Object.values(r)[0])).join("; ");
    if (result !== "ok") return { ok: false, error: "integrity_check: " + result.slice(0, 300) };
    const tables = new Set(
      (await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type = 'table'")).map((t) => t.name)
    );
    if (!tables.has("WorkOrder") || !tables.has("User")) return { ok: false, error: "not a workshop database" };
    let workOrders = null;
    let lastWorkOrderAt = null;
    try {
      const c = await db.$queryRawUnsafe('SELECT COUNT(*) AS n, MAX("createdAt") AS last FROM "WorkOrder"');
      workOrders = Number(c[0].n);
      const last = c[0].last;
      // Prisma stores DateTime as milliseconds since 1970 (INTEGER) or as ISO text in older files.
      const d = last == null ? null : new Date(typeof last === "bigint" ? Number(last) : /^\d+$/.test(String(last)) ? Number(last) : String(last));
      lastWorkOrderAt = d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
    } catch {}
    return { ok: true, workOrders, lastWorkOrderAt };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  const [file, serverDir] = process.argv.slice(2);
  if (!file || !serverDir) {
    print({ ok: false, error: "usage: db-check.js <file> <serverDir>" });
    process.exit(2);
  }
  check(file, serverDir)
    .then((r) => {
      print(r);
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      print({ ok: false, error: String((e && e.message) || e).slice(0, 300) });
      process.exit(1);
    });
}

module.exports = { check };
