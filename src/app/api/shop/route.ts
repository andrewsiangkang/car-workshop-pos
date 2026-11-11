import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const __denied = await requireAuth();
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
    return NextResponse.json(shop);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load shop details" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const body = await request.json();
    let shop = await prisma.shopProfile.findFirst();

    if (!shop) {
      shop = await prisma.shopProfile.create({
        data: {
          name: body.name || "Workshop",
          nameMs: body.nameMs || null,
          address: body.address || null,
          phone: body.phone || null,
          email: body.email || null,
          tin: body.tin || null,
          brn: body.brn || null,
          sstNumber: body.sstNumber || "NA",
          msicCode: body.msicCode || null,
          msicDesc: body.msicDesc || null,
          myInvoisClientId: body.myInvoisClientId || null,
          myInvoisClientSecret: body.myInvoisClientSecret || null,
          myInvoisSandbox: body.myInvoisSandbox !== false,
          bankName: body.bankName || null,
          bankAccount: body.bankAccount || null,
          paymentQrUrl: body.paymentQrUrl || null,
          receiptFooter: body.receiptFooter || null,
        },
      });
    } else {
      shop = await prisma.shopProfile.update({
        where: { id: shop.id },
        data: {
          name: body.name,
          nameMs: body.nameMs || null,
          address: body.address || null,
          phone: body.phone || null,
          email: body.email || null,
          tin: body.tin || null,
          brn: body.brn || null,
          sstNumber: body.sstNumber || "NA",
          msicCode: body.msicCode || null,
          msicDesc: body.msicDesc || null,
          myInvoisClientId: body.myInvoisClientId || null,
          myInvoisClientSecret: body.myInvoisClientSecret || null,
          myInvoisSandbox: body.myInvoisSandbox !== false,
          bankName: body.bankName || null,
          bankAccount: body.bankAccount || null,
          paymentQrUrl: body.paymentQrUrl || null,
          receiptFooter: body.receiptFooter || null,
        },
      });
    }

    return NextResponse.json(shop);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
