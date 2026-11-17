import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 8 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
export async function POST(request: Request) {
  const denied = await requireAuth(); if (denied) return denied;
  let storedPath: string | null = null;
  try {
    const actor = await getCurrentUser(); if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const form = await request.formData(); const file = form.get("file");
    const findingId = String(form.get("findingId") || ""); const checkInId = String(form.get("checkInId") || "");
    if (!(file instanceof File) || (!findingId && !checkInId) || (findingId && checkInId)) return NextResponse.json({ error: "Choose one inspection finding or check-in and attach an image" }, { status: 400 });
    if (!MIME_EXT[file.type] || file.size < 1 || file.size > MAX_BYTES) return NextResponse.json({ error: "Only JPG, PNG or WEBP images up to 8 MB are allowed" }, { status: 400 });
    if (findingId && !await prisma.inspectionFinding.findUnique({ where: { id: findingId }, select: { id: true } })) return NextResponse.json({ error: "Inspection finding not found" }, { status: 404 });
    if (checkInId && !await prisma.vehicleCheckIn.findUnique({ where: { id: checkInId }, select: { id: true } })) return NextResponse.json({ error: "Vehicle check-in not found" }, { status: 404 });
    const bytes = Buffer.from(await file.arrayBuffer());
    // Do not trust the browser-supplied MIME type: verify the actual file signature.
    const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    const signatureMatches = (file.type === "image/jpeg" && isJpeg) || (file.type === "image/png" && isPng) || (file.type === "image/webp" && isWebp);
    if (!signatureMatches) return NextResponse.json({ error: "The uploaded file content does not match its image type" }, { status: 400 });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const dataDir = process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data");
    const folder = path.join(dataDir, "workshop-photos", new Date().toISOString().slice(0,7));
    await fs.mkdir(folder, { recursive: true });
    const filename = `${randomUUID()}${MIME_EXT[file.type]}`;
    const absolute = path.join(folder, filename);
    await fs.writeFile(absolute, bytes, { flag: "wx" });
    storedPath = path.relative(dataDir, absolute);
    const caption = String(form.get("caption") || "").slice(0,200);
    const row = findingId
      ? await prisma.inspectionPhoto.create({ data: { findingId, filePath: storedPath, sha256, caption, photoStage: ["BEFORE","DURING","AFTER"].includes(String(form.get("photoStage"))) ? String(form.get("photoStage")) : "DURING" } })
      : await prisma.checkInPhoto.create({ data: { checkInId, filePath: storedPath, sha256, caption } });
    await writeAuditLog({ actor, request, action: "WORKSHOP_PHOTO_UPLOADED", entityType: findingId ? "InspectionPhoto" : "CheckInPhoto", entityId: row.id, summary: "Workshop photo stored locally", details: { mimeType: file.type, bytes: file.size, sha256 } });
    return NextResponse.json({ ...row, filePath: storedPath }, { status: 201 });
  } catch (error) {
    if (storedPath) { const dataDir = process.env.WORKSHOP_DATA_DIR || path.join(process.cwd(), "data"); try { await fs.rm(path.join(dataDir, storedPath), { force: true }); } catch {} }
    console.error(error); return NextResponse.json({ error: "Unable to store workshop photo" }, { status: 500 });
  }
}
