import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { NewVoucherForm } from "@/components/suppliers/NewVoucherForm";
import { prisma } from "@/lib/prisma";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function PaymentVouchersPage() {
  const list = await prisma.paymentVoucher.findMany({ orderBy: { paidAt: "desc" }, take: 300 });
  return (
    <div className="max-w-5xl">
      <Header title="Payment Vouchers" description="Records of money paid out: to suppliers and for other expenses." />
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">New Voucher (no supplier invoice)</h2>
        <NewVoucherForm />
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Voucher No.</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Pay to</th>
              <th className="px-5 py-3 font-medium">Purpose</th>
              <th className="px-5 py-3 font-medium">Payment Method</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                  No vouchers yet
                </td>
              </tr>
            )}
            {list.map((v) => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-5 py-3">
                  <Link href={`/payment-vouchers/${v.id}`} className="font-medium text-blue-700 hover:underline">
                    {v.number}
                  </Link>
                </td>
                <td className="px-5 py-3">{formatDate(v.paidAt)}</td>
                <td className="px-5 py-3">{v.payee}</td>
                <td className="px-5 py-3 text-slate-500">{v.purpose}</td>
                <td className="px-5 py-3">
                  {PAYMENT_LABEL[v.method] || v.method}
                  {v.shiftId && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">From Drawer</span>}
                </td>
                <td className={`px-5 py-3 text-right ${v.voidedAt ? "text-slate-400 line-through" : ""}`}>
                  {formatCurrency(v.amount)}
                  {v.voidedAt && <span className="ml-2 text-xs">VOID</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
