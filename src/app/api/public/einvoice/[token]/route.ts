import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { buyerRequestLockFor, tooManyRequests, validateBuyer } from "@/lib/einvoice-request";
import { notInFlightWhere } from "@/lib/einvoice2-submit.mjs";

export const dynamic = "force-dynamic";

/**
 * Version of the PDPA notice shown on the form (BuyerRequestForm), kept with each consent.
 * v2: the TIN became optional for a Malaysian individual (IC), so the notice lists it as optional.
 */
const PRIVACY_NOTICE_VERSION = "2026-11-v2";

/** Audit "actor" for what a customer sends from the public QR page (nobody is logged in). */
const QR_CUSTOMER = { id: "", name: "Customer (QR form)", email: "", role: "CUSTOMER" };

/**
 * PUBLIC (no login): the customer sends their e-Invoice details from the QR code.
 * Only the unguessable token in the link is accepted, and only the buyer fields are written.
 * The link closes once staff have saved the buyer, the invoice is e-Invoiced or consolidated,
 * or the consolidation deadline of its month (7th of next month, Malaysia time) has passed.
 */
// 【中文】公开接口（不用登录）：顾客扫码提交电子发票资料。店员已填好、已开电子发票 / 已并入合并发票、或过了次月 7 号截止日后，一律拒绝；必须勾选 PDPA 同意。
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (tooManyRequests(token)) return NextResponse.json({ error: "too_many" }, { status: 429 });

  const order = await prisma.workOrder.findUnique({
    where: { eInvoiceToken: token },
    select: {
      id: true, invoiceNumber: true, status: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true,
      consolidatedId: true, invoicedAt: true, buyerRequestedAt: true, eInvoiceSubmittingAt: true,
    },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { lock, deadline, env } = await buyerRequestLockFor(order);
  if (lock !== "none") return NextResponse.json({ error: lock, deadline }, { status: 409 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const v = validateBuyer(body);
  if (!v.ok) return NextResponse.json({ error: "invalid", fields: v.errors }, { status: 422 });

  const b = v.value;
  const consentAt = new Date();
  // Written only while no submission holds the invoice (staff may have pressed Submit since the
  // check above): LHDN must get the buyer that is stored. 【中文】只在没有提交占位时才写入，避免 LHDN 收到的买方和保存的不同。
  const saved = await prisma.workOrder.updateMany({
    where: { id: order.id, ...notInFlightWhere(env) },
    data: {
      buyerRequestedAt: consentAt,
      buyerConsentAt: consentAt,
      buyerConsentNotice: PRIVACY_NOTICE_VERSION,
      buyerName: b.name,
      // Blank for a Malaysian individual who gave no TIN: LHDN's general TIN is sent with the IC.
      buyerTin: b.tin || null,
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
  if (saved.count === 0) return NextResponse.json({ error: "submitted", deadline }, { status: 409 });
  // Evidence of the request and the customer's PDPA consent (no personal details in the log).
  await writeAuditLog({
    actor: QR_CUSTOMER,
    request,
    action: "EINVOICE_BUYER_REQUESTED",
    entityType: "WorkOrder",
    entityId: order.id,
    summary: `Customer sent e-Invoice buyer details by QR for ${order.invoiceNumber}`,
    details: {
      invoiceNumber: order.invoiceNumber,
      consentAt: consentAt.toISOString(),
      privacyNotice: PRIVACY_NOTICE_VERSION,
      correction: !!order.buyerRequestedAt,
    },
  });
  return NextResponse.json({ ok: true });
}
