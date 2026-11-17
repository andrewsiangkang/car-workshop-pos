import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { writeAuditLog } from "@/lib/audit";
import { getConfiguredAuthSecret } from "@/lib/session-token.mjs";
import { INTERNAL_HEADER, checkInternalToken, isLoopbackAddress, isLoopbackHost } from "@/lib/internal-auth.mjs";
import { schemaReady } from "@/lib/schema-upgrade";

/**
 * Desktop-app-only endpoint (Electron main process → embedded server, same PC).
 *   snapshot  consistent copy of the live database with SQLite VACUUM INTO
 *   verify    open a candidate restore file and run PRAGMA integrity_check
 *   whoami    who is logged in in the app window (restore and backup settings are boss-only)
 *   audit     record a backup / restore event made in the desktop app
 * Every call must carry the HMAC token only the desktop app can make (from AUTH_SECRET),
 * come from this computer, name 127.0.0.1 / localhost as the host, and have no Origin
 * header (browsers always send one on POST). Paths must stay inside the data folder.
 * These checks are the gate, so src/middleware.ts should let this path through without a login
 * session: scheduled and on-quit backups usually run after the window was logged out for
 * inactivity (whoami / audit still need the boss's session below).
 * 【中文】仅供桌面程序调用的内部接口：一致性快照（VACUUM INTO）、还原前校验、确认老板身份、写审计日志。
 * 必须带只有桌面程序能生成的签名、来自本机、不能来自浏览器；文件路径只能在数据文件夹内。
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUDIT_ACTIONS = new Set([
  "BACKUP_RESTORE_STARTED",
  "BACKUP_PASSWORD_SET",
  "BACKUP_PASSWORD_REMOVED",
  "BACKUP_FOLDER_CHANGED",
  "BACKUP_SETTINGS_CHANGED",
  "BACKUP_PLAIN_COPIES_DELETED",
]);

function dataDir() {
  return path.resolve(process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data"));
}

function liveDbPath() {
  const url = process.env.DATABASE_URL || "";
  return url.startsWith("file:") ? path.resolve(url.slice(5).split("?")[0]) : "";
}

/** Absolute path when `p` is inside `root` (never the root itself), otherwise null. */
function inside(root: string, p: unknown) {
  if (typeof p !== "string" || !p || p.includes("\0")) return null;
  const abs = path.resolve(p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return abs;
}

function samePath(a: string, b: string) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// 【中文】确认请求来自本机的桌面程序。没有真正配置 AUTH_SECRET（npm run dev）时一律拒绝：开发用密钥是公开的，签名可被伪造。
function fromDesktopApp(request: Request) {
  // Only the desktop app's real AUTH_SECRET: the dev fallback secret is public, so a token keyed
  // with it proves nothing (the desktop app always sets AUTH_SECRET).
  const secret = getConfiguredAuthSecret();
  if (!secret) return false;
  if (!checkInternalToken(request.headers.get(INTERNAL_HEADER), secret)) return false;
  // Next.js fills x-forwarded-for from the socket when the caller did not send one.
  if (!isLoopbackAddress(request.headers.get("x-forwarded-for"))) return false;
  if (!isLoopbackHost(request.headers.get("host"))) return false;
  return !request.headers.get("origin");
}

/** Open another database file read-only-ish and check it is a healthy shop database. */
// 【中文】校验待还原的数据库文件：完整性检查通过，并且确实是本程序的数据库。
async function checkDatabaseFile(file: string) {
  const db = new PrismaClient({ datasourceUrl: "file:" + file.replace(/\\/g, "/") });
  try {
    // integrity_check (not quick_check): it also checks that every index matches its table, so a
    // backup with a damaged index is refused instead of causing wrong lookups after the restore.
    const rows = await db.$queryRawUnsafe<Array<Record<string, unknown>>>("PRAGMA integrity_check");
    const result = rows.map((r) => String(Object.values(r)[0])).join("; ");
    if (result !== "ok") return { ok: false as const, error: "integrity_check: " + result.slice(0, 300) };
    const tables = new Set(
      (await db.$queryRawUnsafe<Array<{ name: string }>>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((t) => t.name)
    );
    if (!tables.has("WorkOrder") || !tables.has("User")) return { ok: false as const, error: "not a workshop database" };
    // A short summary for the confirmation dialog (best effort: older backups may lack columns).
    let workOrders: number | null = null;
    let lastWorkOrderAt: string | null = null;
    try {
      workOrders = await db.workOrder.count();
      const last = await db.workOrder.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      lastWorkOrderAt = last?.createdAt ? last.createdAt.toISOString() : null;
    } catch {}
    return { ok: true as const, workOrders, lastWorkOrderAt };
  } catch (e) {
    return { ok: false as const, error: String((e as Error)?.message || e).slice(0, 300) };
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

export async function POST(request: Request) {
  if (!fromDesktopApp(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const root = dataDir();
  const live = liveDbPath();
  // A database upgrade that failed at start is tried again here (the desktop app calls this
  // route for backups and restores), instead of staying failed until the app is restarted.
  // Not before a snapshot: a backup copies the database as it is, and must stay quick (the
  // final backup when the app closes has 60 seconds). /api/version also retries.
  // 【中文】启动时升级失败的话，这里会再试；但做备份快照前不试（备份要快，关闭程序时的最后备份只有 60 秒）。
  if (body.action !== "snapshot") await schemaReady();

  try {
    switch (body.action) {
      case "snapshot": {
        // Destination: a new ".partial" file under <data>/backups; the desktop app checks it and renames it.
        const dest = inside(path.join(root, "backups"), body.dest);
        if (!dest || !dest.endsWith(".partial")) return NextResponse.json({ error: "invalid destination" }, { status: 400 });
        if (fs.existsSync(dest)) return NextResponse.json({ error: "destination exists" }, { status: 409 });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await prisma.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
        return NextResponse.json({ ok: true, size: fs.statSync(dest).size });
      }
      case "verify": {
        const file = inside(root, body.file);
        if (!file || (live && samePath(file, live))) return NextResponse.json({ error: "invalid file" }, { status: 400 });
        if (!fs.existsSync(file)) return NextResponse.json({ error: "file not found" }, { status: 404 });
        const r = await checkDatabaseFile(file);
        return NextResponse.json(r, { status: r.ok ? 200 : 422 });
      }
      case "whoami": {
        const user = await getCurrentUser();
        if (!user || !isOwner(user)) return NextResponse.json({ error: "owner-only" }, { status: 403 });
        return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
      }
      case "audit": {
        const user = await getCurrentUser();
        if (!user || !isOwner(user)) return NextResponse.json({ error: "owner-only" }, { status: 403 });
        const action = String(body.auditAction || "");
        if (!AUDIT_ACTIONS.has(action)) return NextResponse.json({ error: "invalid action" }, { status: 400 });
        const details = body.details && typeof body.details === "object" ? (body.details as Record<string, unknown>) : undefined;
        await writeAuditLog({
          actor: user,
          request,
          action,
          entityType: "Backup",
          entityId: null,
          summary: String(body.summary || action).slice(0, 240),
          details,
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    console.error("[internal/backup]", e);
    return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 300) }, { status: 500 });
  }
}
