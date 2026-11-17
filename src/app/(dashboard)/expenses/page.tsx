import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { VoidButton } from "@/components/suppliers/VoidButton";
import { prisma } from "@/lib/prisma";
import { SERVICE_CATEGORY } from "@/lib/supplier-parse";
import { requirePageOwner } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/utils";
import { EXPENSE_CATEGORIES } from "@/lib/money-expense.mjs";
import { operatingExpenses } from "@/lib/money-reports.mjs";
import { myDateKey, myMonthKey, parseMyMonth, shiftMonthKey } from "@/lib/money-time.mjs";
import { ExpenseForm } from "./ExpenseForm";

export const dynamic = "force-dynamic";

/**
 * 【中文】营业开支（仅老板）：按月查看、新增、作废（写原因，不删除）。报表的"营业开支" = 这里的开支 + 不是付供应商发票的付款凭证。
 * Operating expenses (boss only): list by month, add, void with a reason (never deleted).
 */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requirePageOwner();
  const { month: asked } = await searchParams;
  const now = new Date();
  const thisMonth = myMonthKey(now);
  const month = asked && parseMyMonth(asked) && asked <= thisMonth ? asked : thisMonth;
  const range = parseMyMonth(month)!;

  const [list, vouchers, supplierCharges, supplierTax] = await Promise.all([
    prisma.expense.findMany({
      where: { expenseDate: { gte: range.start, lt: range.end } },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    }),
    // Vouchers that are not supplier-invoice payments already count as operating expenses.
    prisma.paymentVoucher.findMany({
      where: { voidedAt: null, supplierInvoiceId: null, paidAt: { gte: range.start, lt: range.end } },
      orderBy: { paidAt: "desc" },
      select: { id: true, number: true, payee: true, purpose: true, amount: true, paidAt: true, voidedAt: true, supplierInvoiceId: true },
    }),
    // Delivery / service charges on supplier invoices dated this month (never stock, so counted as expenses).
    prisma.supplierInvoiceItem.findMany({
      where: { inventoryItemId: null, category: SERVICE_CATEGORY, invoice: { voidedAt: null, invoiceDate: { gte: range.start, lt: range.end } } },
      select: { total: true },
    }),
    // Tax paid on supplier invoices dated this month (parts cost is before tax, so the tax is an expense).
    prisma.supplierInvoice.findMany({
      where: { voidedAt: null, taxAmount: { gt: 0 }, invoiceDate: { gte: range.start, lt: range.end } },
      select: { taxAmount: true },
    }),
  ]);
  const totals = operatingExpenses({ expenses: list, vouchers, supplierCharges, supplierTax });
  const byCategory = new Map<string, number>();
  for (const e of list) {
    if (e.voidedAt) continue;
    const k = e.category || "Other";
    byCategory.set(k, (byCategory.get(k) || 0) + e.amount);
  }
  const prev = shiftMonthKey(month, -1);
  const next = shiftMonthKey(month, 1);

  return (
    <div className="max-w-5xl">
      <Header title="Expenses" description="Operating costs such as rent, utilities and wages, counted in Business Intelligence." />

      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="mb-1 font-semibold">Record each cost once</div>
        <ul className="list-disc space-y-1 pl-5">
          <li>Record here the costs paid outside this system: bank transfer, card or auto-debit (e.g. rent, electricity, internet, wages paid by transfer).</li>
          <li>A cost paid with a Payment Voucher (not for a supplier invoice) is already counted as an operating expense. Do not record it here again.</li>
          <li>Parts and stock bought from a supplier go in Supplier Invoices, not here: their cost is counted when the parts are sold. Delivery and service charges and the tax on a supplier invoice are counted as expenses automatically.</li>
          <li>A wrong entry is voided with a reason. It is kept on record but no longer counted.</li>
        </ul>
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">Add Expense</h2>
        <ExpenseForm today={myDateKey(now)} categories={EXPENSE_CATEGORIES} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/expenses?month=${prev}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
            ‹ {prev}
          </Link>
          <span className="px-2 text-base font-semibold text-slate-900">{month}</span>
          {month < thisMonth && (
            <Link href={`/expenses?month=${next}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50">
              {next} ›
            </Link>
          )}
        </div>
        <form method="get" className="flex items-center gap-2">
          <input type="month" name="month" defaultValue={month} max={thisMonth} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">View</button>
        </form>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Expenses recorded here</div>
          <div className="text-xl font-bold text-slate-900">{formatCurrency(totals.expenses)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Paid by payment voucher</div>
          <div className="text-xl font-bold text-slate-900">{formatCurrency(totals.vouchers)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Delivery and service charges on supplier invoices</div>
          <div className="text-xl font-bold text-slate-900">{formatCurrency(totals.supplierCharges)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">Tax on supplier invoices</div>
          <div className="text-xl font-bold text-slate-900">{formatCurrency(totals.supplierTax)}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs text-amber-800">Total operating expenses</div>
          <div className="text-xl font-bold text-amber-900">{formatCurrency(totals.total)}</div>
        </div>
      </div>

      {byCategory.size > 0 && (
        <div className="mb-6 flex flex-wrap gap-2 text-sm">
          {[...byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([c, amt]) => (
            <span key={c} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
              <span>{c}</span> · {formatCurrency(amt)}
            </span>
          ))}
        </div>
      )}

      <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                  No expenses recorded for this month
                </td>
              </tr>
            )}
            {list.map((e) => (
              <tr key={e.id} className={e.voidedAt ? "bg-slate-50 text-slate-400" : "hover:bg-slate-50"}>
                <td className="px-4 py-3 whitespace-nowrap">{formatDate(e.expenseDate)}</td>
                <td className="px-4 py-3">
                  <div className={e.voidedAt ? "line-through" : "font-medium text-slate-900"}>{e.title}</div>
                  {e.notes && <div className="text-xs text-slate-500">{e.notes}</div>}
                  {e.voidedAt && (
                    <div className="text-xs text-red-600">
                      <span>VOID</span> {formatDate(e.voidedAt)} · {e.voidReason}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">{e.category || "-"}</td>
                <td className={`px-4 py-3 text-right ${e.voidedAt ? "line-through" : "font-medium"}`}>{formatCurrency(e.amount)}</td>
                <td className="px-4 py-3 text-right">
                  {!e.voidedAt && (
                    <div className="flex justify-end">
                      <VoidButton
                        url={`/api/expenses/${e.id}/void`}
                        label="Void expense"
                        confirmText="Void this expense? It is kept on record but no longer counted in the reports."
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">Paid by payment voucher this month (already counted)</h2>
          <Link href="/payment-vouchers" className="text-sm text-blue-700 hover:underline">
            Payment Vouchers
          </Link>
        </div>
        {vouchers.length === 0 ? (
          <p className="text-sm text-slate-500">No vouchers this month apart from supplier-invoice payments.</p>
        ) : (
          <div className="space-y-1 text-sm">
            {vouchers.map((v) => (
              <div key={v.id} className="flex justify-between gap-3 border-t border-slate-100 py-1.5">
                <span>
                  <Link href={`/payment-vouchers/${v.id}`} className="text-blue-700 hover:underline">{v.number}</Link> · {formatDate(v.paidAt)} · {v.payee}
                  {v.purpose ? ` · ${v.purpose}` : ""}
                </span>
                <span>{formatCurrency(v.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
