"use client";

import { formatCurrency, formatDate } from "@/lib/utils";
import { printVisibility, printableSstNumber } from "@/lib/doc-print-rules.mjs";

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
    logoUrl?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    tin?: string | null;
    brn?: string | null;
    bankName?: string | null;
    bankAccount?: string | null;
    paymentQrUrl?: string | null;
    sstNumber?: string | null;
  };
  customer: {
    name: string;
    phone: string;
    tin?: string | null;
    /** Printed when known (buyer's QR / staff details); required on an SST invoice. */
    address?: string | null;
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
  taxRate?: number;
  taxScope?: string;
  taxAmount?: number;
  totalAmount: number;
  roundingAdjustment?: number;
  paidAmount?: number;
  notes?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  payments?: Array<{
    method: string;
    amount: number;
    tendered?: number | null;
    changeGiven?: number | null;
    reference?: string | null;
    paidAt: string | Date;
  }>;
  footer?: string | null;
  /** sandbox: issued in the LHDN test system, so it is NOT a valid e-Invoice. */
  eInvoice?: { uuid: string; longId?: string | null; portal?: string; sandbox?: boolean } | null;
  /** Customer scans this on the shop Wi-Fi to fill their own e-Invoice details. */
  buyerRequestUrl?: string | null;
  submissionUid?: string | null;
  eInvoiceStatus?: string | null;
  eInvoiceEnv?: string | null;
  documentSettings?: {
    quotation?: { heading?: string; footer?: string; showSignature?: boolean };
    invoice?: { heading?: string; footer?: string; showSignature?: boolean };
    receipt?: { heading?: string; footer?: string; showSignature?: boolean; paper?: "A5_LANDSCAPE" | "A5_PORTRAIT" };
    showCustomer?: boolean;
    showVehicle?: boolean;
    logoPosition?: "LEFT" | "CENTER" | "RIGHT"; logoWidth?: number; fontSize?: "SMALL" | "NORMAL" | "LARGE";
    showShopAddress?: boolean; showShopPhone?: boolean; showShopEmail?: boolean; showTaxIds?: boolean;
    showDocumentNumber?: boolean; showJobNumber?: boolean; showDocumentDate?: boolean;
    showItemQuantity?: boolean; showItemUnitPrice?: boolean; showPaymentQr?: boolean;
  };
};

const PAY_LABEL: Record<string, string> = { CASH: "Cash", CARD: "Card", TRANSFER: "Bank Transfer", TNG: "Touch 'n Go", OTHER: "Other" };

const TYPE_TITLE = {
  quotation: "QUOTATION",
  invoice: "INVOICE",
  receipt: "RECEIPT",
};

export function DocumentLayout({ data }: { data: DocData }) {
  const settings = data.documentSettings || {};
  const typeSettings = settings[data.type] || {};
  const title = typeSettings.heading?.trim() || TYPE_TITLE[data.type];
  const showSignature = typeSettings.showSignature ?? data.type !== "quotation";
  const receiptPaper = data.type === "receipt" ? settings.receipt?.paper : undefined;
  const isReceiptLandscape = data.type === "receipt" && (receiptPaper || "A5_LANDSCAPE") === "A5_LANDSCAPE";
  const logoPosition = settings.logoPosition || "LEFT";
  const logoWidth = [80, 120, 160, 200].includes(settings.logoWidth || 120) ? settings.logoWidth || 120 : 120;
  const fontScale = settings.fontSize === "SMALL" ? "0.9rem" : settings.fontSize === "LARGE" ? "1.08rem" : "1rem";
  // Template choices, except that an invoice / receipt charging SST always shows what an SST
  // invoice must carry (SST number, addresses, number and date): see doc-print-rules.mjs.
  const show = printVisibility(settings, data);
  const sstNumber = printableSstNumber(data.shop.sstNumber);

  // data-no-i18n: the printed document stays in the language it is issued in (English, as LHDN and
  // the customer get it); the page around it is translated. 【中文】打印的单据本身不翻译，保持英文。
  return (
    <div data-no-i18n className={`print-area mx-auto bg-white p-8 text-slate-900 shadow-sm print:shadow-none ${data.type === "receipt" ? `paper-a5 ${isReceiptLandscape ? "paper-a5-landscape" : "paper-a5-portrait"} max-w-4xl` : "paper-a4 max-w-3xl"}`} style={{ fontSize: fontScale }}>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between border-b border-slate-200 pb-6">
        <div className={`min-w-0 ${logoPosition === "CENTER" ? "text-center" : logoPosition === "RIGHT" ? "text-right" : "text-left"}`}>
          {/* The logo is an uploaded file served by /api/files: a plain <img> keeps it simple to print. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.shop.logoUrl && <img src={data.shop.logoUrl} alt="Workshop logo" style={{ width: `${logoWidth}px`, maxHeight: "90px", objectFit: "contain", marginLeft: logoPosition === "CENTER" ? "auto" : logoPosition === "RIGHT" ? "auto" : "0", marginRight: logoPosition === "CENTER" ? "auto" : logoPosition === "LEFT" ? "auto" : "0" }} className="mb-2" />}
          <h1 className="text-2xl font-bold tracking-tight">{data.shop.name}</h1>
          {show.shopAddress && data.shop.address && (
            <p className="mt-1 text-sm text-slate-600 whitespace-pre-line">
              {data.shop.address}
            </p>
          )}
          <div className="mt-2 space-y-0.5 text-sm text-slate-600">
            {show.shopPhone && data.shop.phone && <p>Tel: {data.shop.phone}</p>}
            {show.shopEmail && data.shop.email && <p>Email: {data.shop.email}</p>}
            {show.taxIds && data.shop.tin && <p>TIN: {data.shop.tin}</p>}
            {show.taxIds && data.shop.brn && <p>BRN: {data.shop.brn}</p>}
            {show.sstNumber && sstNumber && <p>SST No: {sstNumber}</p>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-blue-700">{title}</div>
          <div className="mt-2 text-sm">
            {show.documentNumber && <div><span className="text-slate-500">No.: </span><span className="font-semibold">{data.docNumber}</span></div>}
            {show.jobNumber && <div><span className="text-slate-500">Job: </span>{data.orderNumber}</div>}
            {show.documentDate && <div><span className="text-slate-500">Date: </span>{formatDate(data.date)}</div>}
          </div>
        </div>
      </div>

      {/* Customer & Vehicle */}
      {(show.customer || show.vehicle) && <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
        {show.customer && <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Customer
          </div>
          <div className="font-medium">{data.customer.name}</div>
          <div className="text-slate-600">{data.customer.phone}</div>
          {data.customer.tin && (
            <div className="text-slate-600">TIN: {data.customer.tin}</div>
          )}
          {data.customer.address && (
            <div className="whitespace-pre-line text-slate-600">{data.customer.address}</div>
          )}
        </div>}
        {show.vehicle && <div>
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
        </div>}
      </div>}

      {/* Items table */}
      <table className="mb-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="pb-2 font-medium">Description</th>
            {settings.showItemQuantity !== false && <th className="pb-2 text-right font-medium">Qty</th>}
            {settings.showItemUnitPrice !== false && <th className="pb-2 text-right font-medium">Unit Price</th>}
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
              {settings.showItemQuantity !== false && <td className="py-2.5 text-right">{item.quantity}</td>}
              {settings.showItemUnitPrice !== false && <td className="py-2.5 text-right">{formatCurrency(item.unitPrice)}</td>}
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
        {(data.taxAmount ?? 0) > 0 && (
          <>
            <div className="flex justify-between border-t border-slate-100 pt-1.5">
              <span className="text-slate-500">Total excl. SST</span>
              <span>{formatCurrency(data.totalAmount - (data.taxAmount ?? 0))}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">
                Service Tax {data.taxRate}%{data.taxScope === "LABOR" ? " (on labour)" : ""}
              </span>
              <span>{formatCurrency(data.taxAmount ?? 0)}</span>
            </div>
          </>
        )}
        {data.type === "receipt" && Math.abs(data.roundingAdjustment ?? 0) > 0.0001 && (
          <>
            <div className="flex justify-between border-t border-slate-100 pt-1.5 text-amber-700">
              <span>Cash Rounding (nearest RM0.05)</span>
              <span>{(data.roundingAdjustment ?? 0) > 0 ? "+" : ""}{formatCurrency(data.roundingAdjustment ?? 0)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-900">
              <span>Total Paid after Cash Rounding</span>
              <span>{formatCurrency(data.totalAmount + (data.roundingAdjustment ?? 0))}</span>
            </div>
          </>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
          <span>{(data.taxAmount ?? 0) > 0 ? "Total incl. SST" : "Total"}</span>
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

      {data.type === "receipt" && data.payments && data.payments.length > 0 ? (
        <div className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Payment Details</div>
          {data.payments.map((p, i) => (
            <div key={i} className="border-t border-slate-100 py-1.5 first:border-t-0">
              <div className="flex justify-between">
                <span className="text-slate-700">
                  {formatDate(p.paidAt)} · {p.amount < 0 ? "Refund" : PAY_LABEL[p.method] || p.method}
                  {p.reference ? ` (${p.reference})` : ""}
                </span>
                <span className="font-medium">{formatCurrency(p.amount)}</span>
              </div>
              {p.method === "CASH" && p.amount > 0 && p.tendered != null && (
                <div className="mt-0.5 space-y-0.5 text-slate-600">
                  <div className="flex justify-between">
                    <span>Cash Received</span>
                    <span>{formatCurrency(p.tendered)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-800">
                    <span>Change Returned to Customer</span>
                    <span>{formatCurrency(p.changeGiven ?? 0)}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        data.type === "receipt" &&
        data.paymentMethod && (
          <div className="mt-4 text-sm text-slate-600">
            Payment Method: {PAY_LABEL[data.paymentMethod] || data.paymentMethod}
            {data.paymentReference && <div>Reference: {data.paymentReference}</div>}
          </div>
        )
      )}

      {data.type === "invoice" && (data.shop.bankName || data.shop.bankAccount || data.shop.paymentQrUrl) && (
        <div className="mt-6 flex items-start justify-between gap-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
          <div>
            <div className="font-semibold text-slate-700">Payment Details</div>
            {data.shop.bankName && <div className="mt-1">Bank: {data.shop.bankName}</div>}
            {data.shop.bankAccount && <div>Account: {data.shop.bankAccount}</div>}
            <div className="mt-2 text-xs text-slate-500">Please use invoice number as payment reference.</div>
          </div>
          {settings.showPaymentQr !== false && data.shop.paymentQrUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.shop.paymentQrUrl} alt="Payment QR" className="h-28 w-28 rounded border border-slate-200 object-contain bg-white" />
          )}
        </div>
      )}

      {/* Customer request QR — fill TIN before staff submit to LHDN */}
      {(data.type === "invoice" || data.type === "receipt") && data.buyerRequestUrl && !data.eInvoice && (
        <div className="mt-8 flex items-start gap-6 border-t border-slate-200 pt-6">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={"/api/qr?text=" + encodeURIComponent(data.buyerRequestUrl)}
              alt="Request e-Invoice QR"
              width={140}
              height={140}
              className="rounded border border-slate-200"
            />
          </div>
          <div className="text-xs text-slate-500">
            <div className="mb-1 font-semibold text-slate-700">Request e-Invoice (customer)</div>
            <div className="mt-1 text-slate-600">
              Scan this QR on the shop Wi-Fi to fill in your TIN / ID for an individual LHDN e-Invoice.
            </div>
            <div className="mt-2 text-slate-400">
              顾客扫码填写 e-Invoice 资料（需连店内 Wi-Fi）
            </div>
          </div>
        </div>
      )}

      {/* LHDN validation QR — after Long ID */}
      {(data.type === "invoice" || data.type === "receipt") && data.eInvoice && (
        <div className="mt-8 flex items-start gap-6 border-t border-slate-200 pt-6">
          <div>
            {data.eInvoice.longId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={"/api/qr?text=" + encodeURIComponent(
                  (data.eInvoice.portal || "https://myinvois.hasil.gov.my") + "/" + data.eInvoice.uuid + "/share/" + data.eInvoice.longId
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
          {data.eInvoice.sandbox && (
            <div className="mb-2 rounded border-2 border-red-600 px-2 py-1 text-center text-sm font-bold uppercase text-red-700">
              Sandbox test · Not a valid e-Invoice
            </div>
          )}
            <div className="mb-1 font-semibold text-slate-700">{data.eInvoice.sandbox ? "LHDN MyInvois sandbox (test)" : "LHDN MyInvois e-Invoice"}</div>
            <div>UUID: {data.eInvoice.uuid}</div>
            {data.eInvoice.longId && <div>Long ID: {data.eInvoice.longId}</div>}
            <div className="mt-2 text-slate-400">
              {data.eInvoice.sandbox ? "Test only: this was not reported to LHDN" : "Scan QR to verify on LHDN MyInvois"}
            </div>
          </div>
        </div>
      )}

      {/* Signature / e-Quotation notice */}
      {showSignature && data.type === "quotation" ? (
        <div className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-600">
          <p className="font-semibold text-slate-800">This is a computer-generated quotation.</p>
          <p className="mt-1">No signature is required.</p>
        </div>
      ) : showSignature ? (
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
      ) : null}

      {/* Footer */}
      <div className="mt-10 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        {data.type === "quotation" && (
          <p>{typeSettings.footer || "This quotation is valid for 7 days. Prices may be adjusted based on actual materials used."}</p>
        )}
        {data.type === "invoice" && (
          <p>{typeSettings.footer || "Please make payment within 7 days. Thank you for your business!"}</p>
        )}
        {data.type === "receipt" && (
          <p>{typeSettings.footer || data.footer || "Thank you for your business. We look forward to serving you again!"}</p>
        )}
      </div>
    </div>
  );
}
