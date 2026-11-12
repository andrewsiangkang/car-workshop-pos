import { DocumentLayout } from "@/components/documents/DocumentLayout";
import { EInvoiceForm } from "@/components/documents/EInvoiceForm";
import { PrintButton } from "@/components/documents/PrintButton";
import { loadDocData } from "@/lib/docdata";
import { prisma } from "@/lib/prisma";
import { MY_STATES } from "@/lib/my-states";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = (await headers()).get("host");
  const { data, missing } = await loadDocData(id, "invoice", host);
  if (missing === "order") notFound();

  // Details the customer sent by scanning the QR code (shown to staff before submitting to LHDN).
  const o = data
    ? await prisma.workOrder.findUnique({
        where: { id },
        select: {
          buyerRequestedAt: true, buyerName: true, buyerTin: true, buyerIdType: true, buyerIdNo: true,
          buyerEmail: true, buyerPhone: true, buyerAddress: true, buyerPostcode: true, buyerCity: true, buyerStateCode: true,
        },
      })
    : null;
  const buyer =
    o?.buyerRequestedAt && o.buyerName && o.buyerTin
      ? {
          name: o.buyerName,
          tin: o.buyerTin,
          idType: o.buyerIdType || "",
          idNo: o.buyerIdNo || "",
          email: o.buyerEmail || "",
          phone: o.buyerPhone || "",
          address: o.buyerAddress || "",
          postcode: o.buyerPostcode || "",
          city: o.buyerCity || "",
          state: MY_STATES[o.buyerStateCode || ""] || "",
          requestedAt: formatDate(o.buyerRequestedAt),
        }
      : null;

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/work-orders/${id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Work Order
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Invoice Preview</h1>
        </div>
        {data && <PrintButton />}
      </div>
      {data ? (
        <>
          <EInvoiceForm
            orderId={id}
            initialUuid={data.eInvoice?.uuid}
            initialLongId={data.eInvoice?.longId}
            initialSubmissionUid={data.submissionUid}
            initialStatus={data.eInvoiceStatus}
            buyer={buyer}
          />
          {data.buyerRequestUrl && (
            <div className="no-print mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              <div className="font-semibold">Customer e-Invoice request QR URL</div>
              <p className="mt-1 text-xs text-blue-900/80">
                Phone must be on the same shop Wi-Fi (or the address you set in WORKSHOP_PUBLIC_URL). Confirm this is not localhost before the customer scans the printed QR.
              </p>
              <code className="mt-2 block break-all rounded bg-white/80 px-2 py-1 text-xs text-slate-800">
                {data.buyerRequestUrl}
              </code>
            </div>
          )}
          <DocumentLayout data={data} />
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No invoice yet. Go back to the work order and click “Complete & Generate Invoice”.
        </div>
      )}
    </div>
  );
}
