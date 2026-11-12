import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requestLockReason, tooManyRequests, validateBuyer } from "@/lib/einvoice-request";

export const dynamic = "force-dynamic";

/**
 * PUBLIC (no login): the customer sends their e-Invoice details from the QR code.
 * Only the unguessable token in the link is accepted, and only the buyer fields are written.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (tooManyRequests(token)) return NextResponse.json({ error: "too_many" }, { status: 429 });

  const order = await prisma.workOrder.findUnique({
    where: { eInvoiceToken: token },
    select: { id: true, invoiceNumber: true, status: true, eInvoiceUuid: true, eInvoiceStatus: true, consolidatedId: true },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const lock = requestLockReason(order);
  if (lock !== "none") return NextResponse.json({ error: lock }, { status: 409 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const v = validateBuyer(body);
  if (!v.ok) return NextResponse.json({ error: "invalid", fields: v.errors }, { status: 422 });

  const b = v.value;
  await prisma.workOrder.update({
    where: { id: order.id },
    data: {
      buyerRequestedAt: new Date(),
      buyerName: b.name,
      buyerTin: b.tin,
      buyerIdType: b.idType,
      buyerIdNo: b.idNo,
      buyerEmail: b.email || null,
      buyerPhone: b.phone || null,
      buyerAddress: b.address,
      buyerPostcode: b.postcode,
      buyerCity: b.city,
      buyerStateCode: b.stateCode,
    },
  });
  return NextResponse.json({ ok: true });
}
