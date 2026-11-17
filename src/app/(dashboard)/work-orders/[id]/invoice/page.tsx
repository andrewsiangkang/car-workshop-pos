import { DocumentLayout } from "@/components/documents/DocumentLayout";
import { EInvoiceForm, type BuyerRequest } from "@/components/documents/EInvoiceForm";
import { PrintButton } from "@/components/documents/PrintButton";
import { loadDocData } from "@/lib/docdata";
import { customerQrBlockedByLanSetting } from "@/lib/einvoice-request";
import { prisma } from "@/lib/prisma";
import { buyerEditLock, invoiceBuyer } from "@/lib/doc-snapshot.mjs";
import { GENERAL_PUBLIC_TIN } from "@/lib/einvoice2-ids.mjs";
import { envFromSandboxFlag, isLiveEInvoice } from "@/lib/einvoice-state.mjs";
import { MY_STATES } from "@/lib/my-states";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
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
          eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true, eInvoiceSubmittingAt: true, consolidatedId: true,
          docSnapshot: true,
          customer: { select: { name: true, phone: true, email: true, tin: true, address: true, postcode: true, city: true, stateCode: true } },
        },
      })
    : null;
  // Same lock as save_buyer and the customer's QR form on the server: buyerEditLock with the LHDN
  // system Settings are on (an unanswered SANDBOX test does not lock a real buyer while Settings
  // are on production). The consolidated notice is worked out on its own, so a leftover marker of
  // the invoice's own submission never hides that it is already in a real consolidated e-Invoice.
  // 【中文】和服务器 save_buyer、顾客扫码表格同一个锁（按设置里的 LHDN 系统：设置在正式环境时，沙盒测试没回应不锁买方）。
  // 「已并入合并发票」另外判断，发票自己提交留下的标记不会把它盖掉。
  const linkedCon = o?.consolidatedId
    ? await prisma.consolidatedInvoice.findUnique({
        where: { id: o.consolidatedId },
        select: { eInvoiceUuid: true, eInvoiceStatus: true, eInvoiceEnv: true },
      })
    : null;
  const settingsEnv = envFromSandboxFlag((await prisma.shopProfile.findFirst({ select: { myInvoisSandbox: true } }))?.myInvoisSandbox);
  const buyerLocked = !!o && buyerEditLock(o, linkedCon, settingsEnv) !== null;
  const consolidatedLock = !!o && !isLiveEInvoice(o) && !!o.consolidatedId && (!linkedCon || isLiveEInvoice(linkedCon));
  // Same rule as the print and LHDN (doc-snapshot.mjs): a name and a TIN, or a Malaysian
  // individual's IC number with the TIN left blank (LHDN's general TIN is then sent).
  // 【中文】和打印、LHDN 同一个规则：有名字和 TIN；或马来西亚个人只填身份证号、TIN 留空。
  const icOnly = !o?.buyerTin && (o?.buyerIdType || "").toUpperCase() === "NRIC" && !!o?.buyerIdNo;
  const buyer =
    o?.buyerRequestedAt && o.buyerName && (o.buyerTin || icOnly)
      ? {
          name: o.buyerName,
          tin: o.buyerTin || "",
          idType: o.buyerIdType || "",
          idNo: o.buyerIdNo || "",
          email: o.buyerEmail || "",
          phone: o.buyerPhone || "",
          address: o.buyerAddress || "",
          postcode: o.buyerPostcode || "",
          city: o.buyerCity || "",
          state: MY_STATES[o.buyerStateCode || ""] || "",
          stateCode: o.buyerStateCode || "",
          requestedAt: formatDate(o.buyerRequestedAt),
        }
      : null;
  // No buyer request yet: the staff form starts from the buyer printed on the invoice (frozen when
  // it was issued), so adding a BRN / IC number keeps the printed name, TIN, phone and address
  // instead of saving empty boxes over them. 【中文】还没有买方资料时，表格先填入发票上印的买方（开单时冻结的客户资料），补填 BRN / 身份证时不会把地址清空。
  const printed = o && !buyer ? invoiceBuyer({ order: o, customer: o.customer }) : null;
  const buyerDefaults: Partial<BuyerRequest> | null = printed
    ? {
        name: printed.source === "general_public" || printed.name === "General Public" ? "" : printed.name || "",
        tin: printed.tin && printed.tin !== GENERAL_PUBLIC_TIN ? printed.tin : "",
        email: o?.customer?.email || "",
        phone: printed.phone || "",
        address: printed.address || "",
        postcode: printed.postcode || "",
        city: printed.city || "",
        stateCode: printed.stateCode || "",
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
            initialEnv={data.eInvoiceEnv}
            initialSubmittingAt={o?.eInvoiceSubmittingAt ? o.eInvoiceSubmittingAt.toISOString() : null}
            buyer={buyer}
            defaults={buyerDefaults}
            consolidatedLock={consolidatedLock}
            buyerLocked={buyerLocked}
            settingsEnv={settingsEnv}
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
          {!data.buyerRequestUrl && !data.eInvoice && !o?.buyerRequestedAt && customerQrBlockedByLanSetting() && (
            <div className="no-print mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Customer e-Invoice QR is not printed because phone / tablet access is off (Settings → Phone / Tablet).
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
