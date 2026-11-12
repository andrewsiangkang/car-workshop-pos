import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ShopProfile } from "@prisma/client";
import { MY_STATES } from "@/lib/my-states";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Never send the MyInvois client secret back to the browser. */
function publicShop(shop: ShopProfile) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { myInvoisClientSecret, ...rest } = shop;
  return { ...rest, hasMyInvoisSecret: !!myInvoisClientSecret };
}

const str = (v: unknown, max = 500) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

/** Payment QR must be an uploaded file or an https URL (no javascript:/data: etc.). */
function safeImageUrl(v: unknown) {
  const s = str(v, 1000);
  if (!s) return null;
  if (s.startsWith("/api/files/") || s.startsWith("/uploads/") || s.startsWith("https://")) return s;
  return null;
}

export async function GET() {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  try {
    let shop = await prisma.shopProfile.findFirst();
    if (!shop) {
      shop = await prisma.shopProfile.create({
        data: {
          name: "My Workshop",
          nameMs: null,
          address: "",
          phone: "",
          email: "",
          tin: "",
          brn: "",
          sstNumber: "NA",
          receiptFooter: "Thank you for your business. We look forward to serving you again!",
        },
      });
    }
    return NextResponse.json(publicShop(shop));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load shop details" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const __denied = await requireOwner();
  if (__denied) return __denied;
  try {
    const actor = await getCurrentUser();
    const body = await request.json();
    const existing = await prisma.shopProfile.findFirst();

    const data = {
      name: str(body.name, 200) || existing?.name || "Workshop",
      nameMs: str(body.nameMs, 200),
      address: str(body.address),
      city: str(body.city, 100),
      postcode: (str(body.postcode, 10) || "").replace(/\D/g, "").slice(0, 5) || null,
      stateCode: typeof body.stateCode === "string" && MY_STATES[body.stateCode] ? body.stateCode : null,
      phone: str(body.phone, 50),
      email: str(body.email, 200),
      tin: str(body.tin, 50)?.toUpperCase() ?? null,
      brn: str(body.brn, 50),
      sstNumber: str(body.sstNumber, 50) || "NA",
      sstRate: Math.min(100, Math.max(0, Number(body.sstRate) || 0)),
      sstScope: body.sstScope === "LABOR" ? "LABOR" : "ALL",
      msicCode: str(body.msicCode, 10),
      msicDesc: str(body.msicDesc, 300),
      myInvoisClientId: str(body.myInvoisClientId, 200),
      // Blank = keep the saved secret (the browser never receives it).
      myInvoisClientSecret: str(body.myInvoisClientSecret, 200) ?? existing?.myInvoisClientSecret ?? null,
      myInvoisSandbox: body.myInvoisSandbox !== false,
      bankName: str(body.bankName, 100),
      bankAccount: str(body.bankAccount, 50),
      paymentQrUrl: safeImageUrl(body.paymentQrUrl),
      receiptFooter: str(body.receiptFooter, 1000),
    };

    const shop = existing
      ? await prisma.shopProfile.update({ where: { id: existing.id }, data })
      : await prisma.shopProfile.create({ data });

    if (actor) await writeAuditLog({ actor, request, action: "SHOP_SETTINGS_UPDATED", entityType: "ShopProfile", entityId: shop.id, summary: `Workshop settings updated`, details: { changedFields: Object.keys(data).filter((field) => !["myInvoisClientSecret", "myInvoisClientId", "bankAccount"].includes(field)), myInvoisCredentialsChanged: Boolean(body.myInvoisClientId || body.myInvoisClientSecret) } });
    return NextResponse.json(publicShop(shop));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
