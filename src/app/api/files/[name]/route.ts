import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { requireAuth } from "@/lib/auth";
import { uploadDir, EXT_TO_TYPE, SAFE_NAME } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Serve an uploaded image (logged-in users only). */
export async function GET(_: Request, { params }: { params: Promise<{ name: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { name } = await params;
  if (!SAFE_NAME.test(name)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const buf = await readFile(path.join(uploadDir(), name));
    return new NextResponse(buf, {
      headers: {
        "Content-Type": EXT_TO_TYPE[name.split(".").pop()!],
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
