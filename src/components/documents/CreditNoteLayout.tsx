import { formatCurrency, formatDate } from "@/lib/utils";

export type CreditNoteData = {
  number: string;
  date: string | Date;
  invoiceNumber: string;
  invoiceDate?: string | Date | null;
  orderNumber: string;
  reason: string;
  amount: number;
  taxAmount: number;
  taxRate: number;
  refundAmount: number;
  refundMethod?: string | null;
  shop: { name: string; address?: string | null; phone?: string | null; tin?: string | null; brn?: string | null; sstNumber?: string | null };
  customer: { name: string; phone: string; tin?: string | null };
  plateNumber: string;
  eInvoice?: { uuid: string; longId?: string | null; portal: string } | null;
};

const PAY: Record<string, string> = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank Transfer", TNG: "Touch 'n Go", OTHER: "Other" };

/** Printable credit note (A4). */
export function CreditNoteLayout({ data }: { data: CreditNoteData }) {
  const net = data.amount - data.taxAmount;
  return (
    <div className="print-area paper-a4 mx-auto max-w-3xl bg-white p-8 text-slate-900 shadow-sm print:shadow-none">
      <div className="mb-8 flex items-start justify-between border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{data.shop.name}</h1>
          {data.shop.address && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{data.shop.address}</p>}
          <div className="mt-2 space-y-0.5 text-sm text-slate-600">
            {data.shop.phone && <p>Tel: {data.shop.phone}</p>}
            {data.shop.tin && <p>TIN: {data.shop.tin}</p>}
            {data.shop.brn && <p>BRN: {data.shop.brn}</p>}
            {data.shop.sstNumber && data.shop.sstNumber.toUpperCase() !== "NA" && <p>SST No: {data.shop.sstNumber}</p>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-red-700">CREDIT NOTE</div>
          <div className="mt-2 text-sm">
            <div><span className="text-slate-500">No.: </span><span className="font-semibold">{data.number}</span></div>
            <div><span className="text-slate-500">Date: </span>{formatDate(data.date)}</div>
            <div><span className="text-slate-500">Original invoice: </span>{data.invoiceNumber}</div>
            {data.invoiceDate && <div><span className="text-slate-500">Invoice date: </span>{formatDate(data.invoiceDate)}</div>}
            <div><span className="text-slate-500">Job: </span>{data.orderNumber}</div>
          </div>
        </div>
      </div>

      <div className="mb-6 text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Customer</div>
        <div className="font-medium">{data.customer.name}</div>
        <div className="text-slate-600">{data.customer.phone}</div>
        {data.customer.tin && <div className="text-slate-600">TIN: {data.customer.tin}</div>}
        <div className="text-slate-600">Vehicle: {data.plateNumber}</div>
      </div>

      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="pb-2 font-medium">Reason for credit</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="py-2.5">{data.reason}</td>
            <td className="py-2.5 text-right font-medium">{formatCurrency(net)}</td>
          </tr>
        </tbody>
      </table>

      <div className="ml-auto w-72 space-y-1.5 text-sm">
        {data.taxAmount > 0 && (
          <>
            <div className="flex justify-between"><span className="text-slate-500">Credit excl. SST</span><span>{formatCurrency(net)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Service Tax {data.taxRate}%</span><span>{formatCurrency(data.taxAmount)}</span></div>
          </>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
          <span>Total credited</span><span>{formatCurrency(data.amount)}</span>
        </div>
        {data.refundAmount > 0 && (
          <div className="flex justify-between text-emerald-700">
            <span>Refunded ({PAY[data.refundMethod || ""] || data.refundMethod})</span>
            <span className="font-semibold">{formatCurrency(data.refundAmount)}</span>
          </div>
        )}
      </div>

      {data.eInvoice && (
        <div className="mt-8 flex items-start gap-6 border-t border-slate-200 pt-6">
          {data.eInvoice.longId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={"/api/qr?text=" + encodeURIComponent(`${data.eInvoice.portal}/${data.eInvoice.uuid}/share/${data.eInvoice.longId}`)}
              alt="LHDN MyInvois QR"
              width={140}
              height={140}
              className="rounded border border-slate-200"
            />
          )}
          <div className="text-xs text-slate-500">
            <div className="mb-1 font-semibold text-slate-700">LHDN MyInvois e-Invoice (Credit Note)</div>
            <div>UUID: {data.eInvoice.uuid}</div>
            {data.eInvoice.longId && <div>Long ID: {data.eInvoice.longId}</div>}
          </div>
        </div>
      )}

      <div className="mt-10 text-xs text-slate-500">
        This credit note reduces the amount of invoice {data.invoiceNumber}. The original invoice is not changed.
      </div>
    </div>
  );
}
