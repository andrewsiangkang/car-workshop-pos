"use client";

import { formatCurrency, formatDate } from "@/lib/utils";

export type DocItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  type?: string;
};

export type DocData = {
  type: "quotation" | "invoice" | "receipt";
  docNumber: string;
  orderNumber: string;
  date: string | Date;
  shop: {
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    tin?: string | null;
    brn?: string | null;
    bankName?: string | null;
    bankAccount?: string | null;
    paymentQrUrl?: string | null;
  };
  customer: {
    name: string;
    phone: string;
    tin?: string | null;
  };
  vehicle: {
    plateNumber: string;
    make: string;
    model: string;
    year?: number | null;
    mileage?: number | null;
  };
  items: DocItem[];
  partsAmount: number;
  laborAmount: number;
  discount: number;
  totalAmount: number;
  paidAmount?: number;
  notes?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  footer?: string | null;
  eInvoice?: { uuid: string; longId?: string | null } | null;
};

const PAY_LABEL: Record<string, string> = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank Transfer", TNG: "Touch 'n Go", OTHER: "Other" };

const TYPE_TITLE = {
  quotation: "QUOTATION",
  invoice: "INVOICE",
  receipt: "RECEIPT",
};

export function DocumentLayout({ data }: { data: DocData }) {
  const title = TYPE_TITLE[data.type];

  return (
    <div className={`print-area mx-auto bg-white p-8 text-slate-900 shadow-sm print:shadow-none ${data.type === "receipt" ? "paper-a5 max-w-xl" : "paper-a4 max-w-3xl"}`}>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{data.shop.name}</h1>
          {data.shop.address && (
            <p className="mt-1 text-sm text-slate-600 whitespace-pre-line">
              {data.shop.address}
            </p>
          )}
          <div className="mt-2 space-y-0.5 text-sm text-slate-600">
            {data.shop.phone && <p>Tel: {data.shop.phone}</p>}
            {data.shop.email && <p>Email: {data.shop.email}</p>}
            {data.shop.tin && <p>TIN: {data.shop.tin}</p>}
            {data.shop.brn && <p>BRN: {data.shop.brn}</p>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-blue-700">{title}</div>
          <div className="mt-2 text-sm">
            <div>
              <span className="text-slate-500">No.: </span>
              <span className="font-semibold">{data.docNumber}</span>
            </div>
            <div>
              <span className="text-slate-500">Job: </span>
              {data.orderNumber}
            </div>
            <div>
              <span className="text-slate-500">Date: </span>
              {formatDate(data.date)}
            </div>
          </div>
        </div>
      </div>

      {/* Customer & Vehicle */}
      <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Customer
          </div>
          <div className="font-medium">{data.customer.name}</div>
          <div className="text-slate-600">{data.customer.phone}</div>
          {data.customer.tin && (
            <div className="text-slate-600">TIN: {data.customer.tin}</div>
          )}
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Vehicle
          </div>
          <div className="font-medium">{data.vehicle.plateNumber}</div>
          <div className="text-slate-600">
            {data.vehicle.make} {data.vehicle.model}
            {data.vehicle.year ? ` (${data.vehicle.year})` : ""}
          </div>
          {data.vehicle.mileage != null && (
            <div className="text-slate-600">
              Mileage: {data.vehicle.mileage.toLocaleString()} km
            </div>
          )}
        </div>
      </div>

      {/* Items table */}
      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="pb-2 font-medium">Description</th>
            <th className="pb-2 text-right font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Unit Price</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.items.map((item, idx) => (
            <tr key={idx}>
              <td className="py-2.5">
                <span className="font-medium">{item.description}</span>
                {item.type === "LABOR" && (
                  <span className="ml-2 text-xs text-slate-400">Labor</span>
                )}
              </td>
              <td className="py-2.5 text-right">{item.quantity}</td>
              <td className="py-2.5 text-right">
                {formatCurrency(item.unitPrice)}
              </td>
              <td className="py-2.5 text-right font-medium">
                {formatCurrency(item.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="ml-auto w-64 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Parts Subtotal</span>
          <span>{formatCurrency(data.partsAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Labor Subtotal</span>
          <span>{formatCurrency(data.laborAmount)}</span>
        </div>
        {data.discount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Discount</span>
            <span>-{formatCurrency(data.discount)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
          <span>Total</span>
          <span>{formatCurrency(data.totalAmount)}</span>
        </div>
        {data.type === "receipt" && data.paidAmount != null && (
          <div className="flex justify-between text-emerald-700">
            <span>Paid</span>
            <span className="font-semibold">
              {formatCurrency(data.paidAmount)}
            </span>
          </div>
        )}
      </div>

      {data.notes && (
        <div className="mt-6 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          <span className="font-medium text-slate-700">Notes: </span>
          {data.notes}
        </div>
      )}

      {data.type === "receipt" && data.paymentMethod && (
        <div className="mt-4 text-sm text-slate-600">
          Payment Method: {PAY_LABEL[data.paymentMethod] || data.paymentMethod}
          {data.paymentReference && <div>Reference: {data.paymentReference}</div>}
        </div>
      )}

      {data.type === "invoice" && (data.shop.bankName || data.shop.bankAccount || data.shop.paymentQrUrl) && (
        <div className="mt-6 flex items-start justify-between gap-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div>
            <div className="font-semibold text-slate-700">Payment Details</div>
            {data.shop.bankName && <div className="mt-1">Bank: {data.shop.bankName}</div>}
            {data.shop.bankAccount && <div>Account: {data.shop.bankAccount}</div>}
            <div className="mt-2 text-xs text-slate-500">Please use invoice number as payment reference.</div>
          </div>
          {data.shop.paymentQrUrl && (
            <img src={data.shop.paymentQrUrl} alt="Payment QR" className="h-28 w-28 rounded border border-slate-200 object-contain bg-white" />
          )}
        </div>
      )}

      {data.type === "invoice" && data.eInvoice && (
        <div className="mt-8 flex items-start gap-6 border-t border-slate-200 pt-6">
          <div>
            {data.eInvoice.longId ? (
              <img
                src={"/api/qr?text=" + encodeURIComponent(
                  "https://myinvois.hasil.gov.my/" + data.eInvoice.uuid + "/share/" + data.eInvoice.longId
                )}
                alt="LHDN MyInvois QR"
                width={140}
                height={140}
                className="rounded border border-slate-200"
              />
            ) : (
              <div className="flex h-[140px] w-[140px] items-center justify-center rounded border border-dashed border-slate-300 text-center text-xs text-slate-400">
                QR available after Long ID
              </div>
            )}
          </div>
          <div className="text-xs text-slate-500">
            <div className="mb-1 font-semibold text-slate-700">LHDN MyInvois e-Invoice</div>
            <div>UUID: {data.eInvoice.uuid}</div>
            {data.eInvoice.longId && <div>Long ID: {data.eInvoice.longId}</div>}
            <div className="mt-2 text-slate-400">
              Scan QR to verify on LHDN MyInvois
            </div>
          </div>
        </div>
      )}

      {/* Signature / e-Quotation notice */}
      {data.type === "quotation" ? (
        <div className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-600">
          <p className="font-semibold text-slate-800">This is a computer-generated quotation.</p>
          <p className="mt-1">No signature is required.</p>
        </div>
      ) : (
        <div className="mt-12">
          <p className="mb-6 text-center text-xs text-slate-500">
            Signatures below confirm that both parties have reviewed and agreed to the terms of this document, protecting the interests of both sides.
          </p>
          <div className="grid grid-cols-2 gap-16 text-sm">
            <div>
              <div className="mb-20 border-b border-slate-400"></div>
              <div className="font-medium">Customer Signature</div>
              <div className="mt-1 text-xs text-slate-500">Name: {data.customer.name}</div>
              <div className="mt-2 text-xs text-slate-500">Date: ____________________</div>
            </div>
            <div>
              <div className="mb-20 border-b border-slate-400"></div>
              <div className="font-medium">Workshop / Authorized Signature</div>
              <div className="mt-1 text-xs text-slate-500">{data.shop.name}</div>
              <div className="mt-2 text-xs text-slate-500">Date: ____________________</div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        {data.type === "quotation" && (
          <p>This quotation is valid for 7 days. Prices may be adjusted based on actual materials used.</p>
        )}
        {data.type === "invoice" && (
          <p>Please make payment within 7 days. Thank you for your business!</p>
        )}
        {data.type === "receipt" && (
          <p>{data.footer || "Thank you for your business. We look forward to serving you again!"}</p>
        )}
      </div>
    </div>
  );
}
