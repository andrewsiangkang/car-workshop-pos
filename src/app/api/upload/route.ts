import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { requireOwner } from "@/lib/auth";
import { uploadDir, IMAGE_TYPES } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

/** Upload the payment QR image (boss only — it changes what customers pay into). */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });

    const kind = IMAGE_TYPES[file.type === "image/jpg" ? "image/jpeg" : file.type];
    if (!kind) {
      return NextResponse.json({ error: "Only PNG, JPG, WEBP allowed" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 2MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Check the real file content, not just the browser-supplied type / file name.
    if (!kind.magic(buffer)) {
      return NextResponse.json({ error: "File is not a valid image" }, { status: 400 });
    }

    const filename = `payment-qr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${kind.ext}`;
    const dir = uploadDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);

    return NextResponse.json({ url: `/api/files/${filename}` });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
