import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth(); if (denied) return denied;
  const { id } = await params; const type = new URL(request.url).searchParams.get("type");
  const row = type === "checkin" ? await prisma.checkInPhoto.findUnique({ where: { id }, select: { filePath: true } }) : await prisma.inspectionPhoto.findUnique({ where: { id }, select: { filePath: true } });
  if (!row) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  const dataDir = path.resolve(process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data"));
  const fullPath = path.resolve(dataDir, row.filePath);
  if (!fullPath.startsWith(dataDir + path.sep)) return NextResponse.json({ error: "Invalid photo path" }, { status: 400 });
  try {
    const bytes = await fs.readFile(fullPath); const ext = path.extname(fullPath).toLowerCase();
    const typeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
    return new NextResponse(bytes, { headers: { "Content-Type": typeMap[ext] || "application/octet-stream", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch { return NextResponse.json({ error: "Photo file is missing" }, { status: 404 }); }
}
