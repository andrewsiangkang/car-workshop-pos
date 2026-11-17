import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "@/components/documents/PrintButton";
import { CreditNoteLayout } from "@/components/documents/CreditNoteLayout";
import { fullAddress } from "@/lib/docdata";
import {
  creditNoteBuyer,
  creditNoteSeller,
  parseDocSnapshot,
  printedCreditNoteReference,
  vehicleSnapshot,
} from "@/lib/doc-snapshot.mjs";
import { SELLER_SELECT } from "@/lib/docdata";
import { creditNoteItemLines, portalUrl } from "@/lib/myinvois";
import { SANDBOX, envFromSandboxFlag, recordEnv } from "@/lib/einvoice-state.mjs";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CreditNotePage({ params }: { params: Promise<{ id: string; cnId: string }> }) {
  await requirePageUser();
  const { id, cnId } = await params;
  const cn = await prisma.creditNote.findUnique({
    where: { id: cnId },
    include: {
      workOrder: { include: { customer: true, vehicle: true } },
      lines: { orderBy: { id: "asc" }, select: { description: true, quantity: true, unitPrice: true, total: true, net: true, taxAmount: true } },
    },
  });
  if (!cn || cn.workOrderId !== id) notFound();
  const o = cn.workOrder;
  // Particulars as on the day the credit note was issued (H6). Credit notes issued before
  // v0.3.29 have no snapshot and use the invoice's snapshot, then today's data.
  // 【中文】退款单按开出当天冻结的资料打印；旧退款单没有快照，就用原发票的快照，再没有才用现在的资料。
  const cnSnap = parseDocSnapshot(cn.docSnapshot);
  const invSnap = parseDocSnapshot(o.docSnapshot);
  const [shop, con] = await Promise.all([
    prisma.shopProfile.findFirst({ select: { ...SELLER_SELECT, myInvoisSandbox: true } }),
    o.consolidatedId
      ? prisma.consolidatedInvoice.findUnique({
          where: { id: o.consolidatedId },
          select: { number: true, eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true },
        })
      : Promise.resolve(null),
  ]);
  // A credit note that reverses SST keeps the invoice's SST number (creditNoteSeller).
  const seller = cnSnap?.seller ?? creditNoteSeller({ shop, invoice: invSnap, taxAmount: cn.taxAmount });
  const vehicle = cnSnap?.vehicle ?? invSnap?.vehicle ?? vehicleSnapshot(o.vehicle, o.mileageIn);
  // The same buyer the credit note's e-Invoice names: the invoice's buyer, or General Public when
  // it refers to the monthly consolidated e-Invoice (credit-notes/[id]/einvoice uses this rule too).
  // 【中文】和退款单电子发票同一个买方：原发票的买方；对合并电子发票开的就印 General Public。
  const reference = printedCreditNoteReference({
    creditNote: cn,
    order: o,
    consolidated: con,
    settingsEnv: envFromSandboxFlag(shop?.myInvoisSandbox),
  });
  const buyer = creditNoteBuyer({ creditNote: cn, order: o, customer: o.customer, via: reference?.via });
  // Itemise only when the rows add up to this note's own net and SST: the same rule its e-Invoice
  // uses (creditNoteItemLines). A line credit that closed the invoice takes what was left, so after
  // an earlier amount-only credit its rows no longer add up; then print the summary row, as LHDN gets.
  // 【中文】只有各行加起来等于这张退款单的净额和 SST 时才逐行打印（与电子发票同一规则），否则印一行摘要。
  const itemised = creditNoteItemLines({ amount: cn.amount, taxAmount: cn.taxAmount, taxRate: o.taxRate, lines: cn.lines })
    ? cn.lines.filter((l) => l.quantity > 0)
    : [];

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/work-orders/${id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Work Order
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Credit Note Preview</h1>
        </div>
        <PrintButton />
      </div>
      <CreditNoteLayout
        data={{
          number: cn.number,
          date: cn.createdAt,
          invoiceNumber: o.invoiceNumber || "",
          invoiceDate: o.invoicedAt,
          orderNumber: o.orderNumber,
          reason: cn.reason,
          amount: cn.amount,
          taxAmount: cn.taxAmount,
          taxRate: o.taxRate,
          refundAmount: cn.refundAmount,
          refundMethod: cn.refundMethod,
          lines: itemised,
          shop: {
            name: seller.name,
            address: fullAddress(seller),
            phone: seller.phone,
            tin: seller.tin,
            brn: seller.brn,
            sstNumber: seller.sstNumber,
          },
          customer: { name: buyer.name, phone: buyer.phone || "", tin: buyer.tin, address: fullAddress(buyer) },
          plateNumber: vehicle.plateNumber,
          eInvoice: cn.eInvoiceUuid
            ? {
                uuid: cn.eInvoiceUuid,
                longId: cn.eInvoiceLongId,
                portal: portalUrl(recordEnv(cn) === SANDBOX),
                sandbox: recordEnv(cn) === SANDBOX,
                type: cn.eInvoiceType, // "04" prints as a refund note
              }
            : null,
        }}
      />
    </div>
  );
}
