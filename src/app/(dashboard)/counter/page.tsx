import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { CounterPanel, VarianceText } from "@/components/counter/CounterPanel";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, isOwner } from "@/lib/auth";
import { getOpenShift, summarizeShift } from "@/lib/counter";
import { myDay, parseReconciled, varianceKind } from "@/lib/counter-calc";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_TEXT = { short: "text-red-600", over: "text-amber-600", balanced: "text-emerald-700" };

export default async function CounterPage() {
  const owner = isOwner(await getCurrentUser());
  const open = await getOpenShift();
  const summary = open ? await summarizeShift(open) : null;
  // Float the last closed day left in the drawer = a sensible opening float for today.
  const lastClosed = open
    ? null
    : await prisma.cashShift.findFirst({ where: { closedAt: { not: null } }, orderBy: { closedAt: "desc" }, select: { floatKept: true } });
  const history = owner
    ? await prisma.cashShift.findMany({
        where: { closedAt: { not: null } },
        orderBy: { openedAt: "desc" },
        take: 60,
      })
    : [];

  // Which non-cash methods each settlement had, to show how many still need checking.
  const nonCash = history.length
    ? await prisma.payment.groupBy({
        by: ["shiftId", "method"],
        where: { shiftId: { in: history.map((h) => h.id) }, method: { not: "CASH" } },
        _count: { _all: true },
      })
    : [];
  const toCheck = (h: (typeof history)[number]) => {
    const done = parseReconciled(h.reconciled);
    const methods = nonCash.filter((n) => n.shiftId === h.id).map((n) => n.method);
    return { total: methods.length, left: methods.filter((m) => !done[m]).length };
  };

  return (
    <div className="max-w-5xl">
      <Header title="Counter" description="Open the counter with a float, take payments, then close and settle the cash at the end of the day." />

      <CounterPanel
        open={
          open
            ? {
                id: open.id,
                openedAt: open.openedAt.toISOString(),
                openedByName: open.openedByName,
                openingFloat: open.openingFloat,
                staleDay: myDay(open.openedAt) !== myDay(new Date()),
              }
            : null
        }
        summary={summary}
        suggestedFloat={lastClosed?.floatKept ?? null}
        isOwner={owner}
      />

      {owner && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Settlement History</h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Opened</th>
                  <th className="px-5 py-3 font-medium">Closed by</th>
                  <th className="px-5 py-3 text-right font-medium">Opening Float</th>
                  <th className="px-5 py-3 text-right font-medium">Expected</th>
                  <th className="px-5 py-3 text-right font-medium">Counted</th>
                  <th className="px-5 py-3 text-right font-medium">Result</th>
                  <th className="px-5 py-3 text-right font-medium">Cash to Bank In</th>
                  <th className="px-5 py-3 font-medium">Bank Status</th>
                  <th className="px-5 py-3 font-medium">Other Payments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-5 py-10 text-center text-slate-500">
                      No settlements yet
                    </td>
                  </tr>
                )}
                {history.map((h) => {
                  const v = h.variance ?? 0;
                  const kind = varianceKind(v);
                  return (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <Link href={`/counter/${h.id}`} className="font-medium text-blue-700 hover:underline">
                          {formatDateTime(h.openedAt)}
                        </Link>
                      </td>
                      <td className="px-5 py-3">{h.closedByName}</td>
                      <td className="px-5 py-3 text-right">{formatCurrency(h.openingFloat)}</td>
                      <td className="px-5 py-3 text-right">{formatCurrency(h.expectedCash ?? 0)}</td>
                      <td className="px-5 py-3 text-right">{formatCurrency(h.countedCash ?? 0)}</td>
                      <td className={`px-5 py-3 text-right font-semibold ${KIND_TEXT[kind]}`}>
                        <VarianceText kind={kind} amount={v} />
                      </td>
                      <td className="px-5 py-3 text-right font-medium">
                        {h.depositAmount != null ? formatCurrency(h.depositAmount) : "-"}
                      </td>
                      <td className="px-5 py-3">
                        {h.depositAmount == null || h.depositAmount <= 0 ? (
                          "-"
                        ) : h.depositedAt ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Banked In</span>
                        ) : (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Not Banked In Yet</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {(() => {
                          const c = toCheck(h);
                          if (c.total === 0) return "-";
                          return c.left === 0 ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">All Checked</span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">{c.left} to check</span>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
