import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // QR payloads can contain invoice verification links or internal network URLs.
  const denied = await requireAuth();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text") || "";
  if (!text || text.length > 500) {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }
  try {
    const png = await QRCode.toBuffer(text, { width: 180, margin: 1, errorCorrectionLevel: "M" });
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "QR failed" }, { status: 500 });
  }
}
