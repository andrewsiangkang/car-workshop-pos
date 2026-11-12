import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readFile, mkdir, unlink, readdir, copyFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { uploadDir } from "@/lib/uploads";

export const dynamic = "force-dynamic";

function backupDir() {
  return path.join(process.env.WORKSHOP_DATA_DIR || process.cwd(), "backups");
}

/**
 * Consistent snapshot of the live database. A plain file copy taken while the app is
 * writing can produce a corrupt backup; SQLite's VACUUM INTO copies a clean snapshot.
 */
async function snapshot(dest: string) {
  await mkdir(path.dirname(dest), { recursive: true });
  await prisma.$executeRawUnsafe(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export async function GET() {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  const tmp = path.join(backupDir(), `.download-${stamp()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    await snapshot(tmp);
    const buffer = await readFile(tmp);
    const filename = `workshop-backup-${new Date().toISOString().slice(0, 10)}.db`;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

export async function POST() {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  try {
    const name = `workshop-${stamp()}.db`;
    const dest = path.join(backupDir(), name);
    await snapshot(dest);
    // Uploaded photos (supplier invoices, payment QR) are separate files: copy new ones too.
    const src = uploadDir();
    if (existsSync(src)) {
      const to = path.join(backupDir(), "uploads");
      await mkdir(to, { recursive: true });
      for (const f of await readdir(src)) {
        if (!existsSync(path.join(to, f))) await copyFile(path.join(src, f), path.join(to, f)).catch(() => {});
      }
    }
    // Only the file name goes back to the browser, not the full disk path.
    return NextResponse.json({ ok: true, message: `Backed up to backups/${name}` });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Local backup failed" }, { status: 500 });
  }
}
