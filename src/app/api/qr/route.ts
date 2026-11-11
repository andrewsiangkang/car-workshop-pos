import { NextResponse } from "next/server";
import QRCode from "qrcode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get("text") || "";
  if (!text || text.length > 500) {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }
  try {
    const png = await QRCode.toBuffer(text, { width: 180, margin: 1, errorCorrectionLevel: "M" });
    return new NextResponse(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "QR failed" }, { status: 500 });
  }
}
