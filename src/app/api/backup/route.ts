import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { readFile, copyFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

export async function GET() {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const dbPath = process.env.WORKSHOP_DATA_DIR ? path.join(process.env.WORKSHOP_DATA_DIR, "workshop.db") : path.join(process.cwd(), "prisma", "dev.db");
    if (!existsSync(dbPath)) {
      return NextResponse.json(
        { error: "Database file not found" },
        { status: 404 }
      );
    }

    const buffer = await readFile(dbPath);
    const filename = `workshop-backup-${new Date().toISOString().slice(0, 10)}.db`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Backup failed" }, { status: 500 });
  }
}

export async function POST() {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const dbPath = process.env.WORKSHOP_DATA_DIR ? path.join(process.env.WORKSHOP_DATA_DIR, "workshop.db") : path.join(process.cwd(), "prisma", "dev.db");
    if (!existsSync(dbPath)) {
      return NextResponse.json(
        { error: "Database file not found" },
        { status: 404 }
      );
    }

    const backupDir = path.join(process.env.WORKSHOP_DATA_DIR || process.cwd(), "backups");
    if (!existsSync(backupDir)) {
      await mkdir(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dest = path.join(backupDir, `workshop-${timestamp}.db`);
    await copyFile(dbPath, dest);

    return NextResponse.json({
      ok: true,
      path: dest,
      message: `Backed up to backups/workshop-${timestamp}.db`,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "本地Backup failed" }, { status: 500 });
  }
}
