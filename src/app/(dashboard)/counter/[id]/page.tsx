import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "@/components/documents/PrintButton";
import { VarianceText } from "@/components/counter/CounterPanel";
import { DepositPanel } from "@/components/counter/DepositPanel";
import { isOwner, requirePageUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ReconcilePanel } from "@/components/counter/ReconcilePanel";
import { DENOMS, parseBreakdown, parseReconciled, readClosingSnapshot, varianceKind, type Breakdown } from "@/lib/counter-calc";
import { liveSettlement } from "@/lib/counter";
import { PAYMENT_LABEL } from "@/lib/status";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_BOX = {
  short: "border-red-200 bg-red-50 text-red-700",
  over: "border-amber-200 bg-amber-50 text-amber-800",
  balanced: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

/** Daily settlement report for one counter session: totals, cash check (short / over), every payment, printable. */
export default async function CounterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  const shift = await prisma.cashShift.findUnique({ where: { id } });
  if (!shift) notFound();
  const owner = isOwner(me);
  const closed = !!shift.closedAt;

  // Blind count: staff see a session's figures only after its cash has been counted and the
  // counter closed (checked here on the server, so nothing is sent to the browser).
  // 【中文】盲点数：营业中的时段，店员看不到任何金额（服务器端判断，数字不会送到浏览器）。
  if (!closed && !owner) {
    return (
      <div>
        <div className="no-print mb-6 flex items-center gap-3">
          <Link href="/counter" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Counter
          </Link>
        </div>
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          This counter session is still open. Its settlement is shown after the cash is counted and the counter is closed.
        </div>
      </div>
    );
  }

  const payments = await prisma.payment.findMany({
    where: { shiftId: id },
    orderBy: { paidAt: "asc" },
    include: { workOrder: { select: { orderNumber: true, receiptNumber: true, vehicle: { select: { plateNumber: true } } } } },
  });

  // A closed day reads the totals frozen when it was closed, so a voucher voided later cannot make
  // it stop adding up. Days closed before v0.3.30 have no snapshot and use live figures.
  // 【中文】已关柜的日子用关柜时冻结的数字；v0.3.30 之前关柜的日子没有快照，改用实时数字。
  const frozen = closed ? readClosingSnapshot(shift.closingSnapshot) : null;
  const report = frozen ?? (await liveSettlement(shift));
  const s = report.summary;
  const drawerPayouts = report.drawerPayouts;
  // Drawer vouchers voided after the day was closed: listed for the boss, never counted again.
  const voidedLater =
    owner && closed && shift.closedAt
      ? await prisma.paymentVoucher.findMany({
          where: { shiftId: id, voidedAt: { gt: shift.closedAt } },
          orderBy: { voidedAt: "asc" },
          select: { id: true, number: true, payee: true, amount: true, voidedAt: true, voidReason: true },
        })
      : [];
  // Voids made after the figures were frozen are still inside them ("stay as they were"); voids made
  // before that (days closed before v0.3.30, voided before the upgrade) are already left out.
  // 【中文】冻结之后才作废的凭证仍算在上面的数字里；冻结之前作废的（v0.3.30 之前关柜的日子）已经不算在内。
  const frozenAt = frozen?.at ? new Date(frozen.at) : null;
  const frozenValid = frozenAt && !Number.isNaN(frozenAt.getTime()) ? frozenAt : null;
  const voidedInFigures = voidedLater.filter((v) => frozenValid && v.voidedAt && v.voidedAt >= frozenValid);
  const voidedLeftOut = voidedLater.filter((v) => !(frozenValid && v.voidedAt && v.voidedAt >= frozenValid));
  const expected = shift.expectedCash ?? s.expectedCash;
  const variance = shift.variance ?? 0;
  const kind = varianceKind(variance);
  const otherMethods = s.methods.filter((m) => m.method !== "CASH");
  const parse = (raw: string | null): Breakdown | null => {
    if (!raw) return null;
    try {
      return parseBreakdown(JSON.parse(raw));
    } catch {
      return null;
    }
  };
  const countedBd = parse(shift.countedBreakdown);
  const openingBd = parse(shift.openingCount);
  const floatKept = shift.floatKept ?? null;
  // The bank deposit is boss-only: never computed or sent for staff.
  const deposit = owner ? shift.depositAmount ?? null : null;
  const totalCollected = report.totalCollected;
  const nonCashCollected = report.nonCashCollected;
  const totalBankSettlement = deposit != null ? deposit + nonCashCollected : null;

  // Boss-only profit estimate: parts cost of the jobs paid in this session.
  const partsCost = owner ? report.partsCost : 0;
  const paidOutDrawer = s.cashPayouts;
  const paidOutAll = paidOutDrawer + report.otherVouchers.total;
  const grossProfit = totalCollected - partsCost;
  const otherChecks = parseReconciled(shift.reconciled);

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/counter" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <ArrowLeft className="h-4 w-4" />
            Back to Counter
          </Link>
          <h1 className="text-lg font-semibold text-slate-900">Settlement Preview</h1>
        </div>
        <PrintButton />
      </div>

      <div className="print-area paper-a4 mx-auto max-w-3xl bg-white p-8 text-slate-900 shadow-sm print:shadow-none">
        <div className="mb-6 flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Daily Settlement Report</h1>
            <p className="mt-1 text-sm text-slate-500">{closed ? "Closed" : "Still open - figures so far"}</p>
            {closed && !frozen && (
              <p className="mt-1 text-xs text-slate-400">Closed before v0.3.30: figures are worked out from today&apos;s records.</p>
            )}
          </div>
          <div className="text-right text-sm">
            <div>
              <span className="text-slate-500">Opened: </span>
              {formatDateTime(shift.openedAt)} · {shift.openedByName}
            </div>
            {shift.closedAt && (
              <div>
                <span className="text-slate-500">Closed: </span>
                {formatDateTime(shift.closedAt)} · {shift.closedByName}
              </div>
            )}
          </div>
        </div>

        <div className="mb-6 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Total Collected (all methods)</span>
            <span className="font-semibold">{formatCurrency(totalCollected)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Number of Payments</span>
            <span>{s.paymentCount}</span>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 p-4 text-sm">
          <h2 className="mb-3 font-semibold text-slate-900">Daily Sales by Payment Method</h2>
          <p className="mb-3 text-xs text-slate-500">This is the full amount collected by the business. Only cash is physically deposited from the cash drawer; card, TNG and bank transfer remain in their respective merchant / bank accounts.</p>
          <div className="space-y-2">
            {s.methods.map((m) => (
              <div key={m.method} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span>{PAYMENT_LABEL[m.method] || m.method} <span className="text-xs text-slate-400">({m.count} payment(s))</span></span>
                <span className="font-medium">{formatCurrency(m.net)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t-2 border-slate-200 pt-2 font-bold">
              <span>Total Business Collections</span>
              <span>{formatCurrency(totalCollected)}</span>
            </div>
          </div>
          {owner && (
            <div className="mt-4 rounded-lg bg-blue-50 p-3">
              <div className="flex justify-between font-semibold text-blue-900">
                <span>Cash to Bank In (cash only)</span>
                <span>{closed && deposit != null ? formatCurrency(deposit) : "Calculated at cash closing"}</span>
              </div>
              <p className="mt-1 text-xs text-blue-800">Cash counted minus float kept in the drawer. Do not physically deposit card, DuitNow QR or transfer amounts again; they are already in their respective bank / merchant accounts.</p>
              {closed && deposit != null && (
                <div className="mt-3 space-y-1 border-t border-blue-200 pt-2 text-sm text-blue-950">
                  <div className="flex justify-between"><span>Cash deposit</span><span>{formatCurrency(deposit)}</span></div>
                  <div className="flex justify-between"><span>Electronic payments already credited</span><span>{formatCurrency(nonCashCollected)}</span></div>
                  <div className="flex justify-between border-t border-blue-200 pt-2 font-bold"><span>Total bank / payment-channel settlement</span><span>{formatCurrency(totalBankSettlement ?? 0)}</span></div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mb-6 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Opening Float</span>
            <span>{formatCurrency(s.openingFloat)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">+ Cash Received from Customers</span>
            <span>{formatCurrency(s.cashReceived)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">− Change Given Back</span>
            <span>{formatCurrency(s.changeGiven)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">− Cash Refunds</span>
            <span>{formatCurrency(s.cashRefunds)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">− Cash Paid Out from Drawer</span>
            <span>{formatCurrency(paidOutDrawer)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold">
            <span>Expected Cash in Drawer</span>
            <span>{formatCurrency(expected)}</span>
          </div>
          {closed && (
            <>
              <div className="flex justify-between font-semibold">
                <span>Cash Counted</span>
                <span>{formatCurrency(shift.countedCash ?? 0)}</span>
              </div>
              <div className={`mt-2 flex justify-between rounded-lg border px-4 py-3 text-base font-bold ${KIND_BOX[kind]}`}>
                <span>Result</span>
                <span>
                  <VarianceText kind={kind} amount={variance} />
                </span>
              </div>
            </>
          )}
        </div>

        {shift.notes && (
          <div className="mb-6 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <span className="font-medium text-slate-700">Notes: </span>
            {shift.notes}
          </div>
        )}

        {owner && closed && deposit != null && (
          <div className="mb-6 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Bank Deposit</div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Cash Counted</span>
                <span>{formatCurrency(shift.countedCash ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">− Float Kept in Drawer for Tomorrow</span>
                <span>{formatCurrency(floatKept ?? 0)}</span>
              </div>
              <div className="flex justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-base font-bold text-blue-800">
                <span>Cash to Bank In</span>
                <span>{formatCurrency(deposit)}</span>
              </div>
              <div className="text-xs text-slate-400">Before deducting costs (parts, supplier payments, expenses).</div>
            </div>
          </div>
        )}

        {owner && closed && deposit != null && deposit > 0 && (
          <DepositPanel
            shiftId={shift.id}
            amount={deposit}
            depositedAt={shift.depositedAt ? shift.depositedAt.toISOString() : null}
            depositedByName={shift.depositedByName}
            depositRef={shift.depositRef}
            canEdit={owner}
          />
        )}

        {(countedBd || openingBd) && (
          <div className="mb-6 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes &amp; Coins Count</div>
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="pb-2 font-medium">Note / Coin</th>
                  {openingBd && <th className="pb-2 text-right font-medium">Opening</th>}
                  {countedBd && <th className="pb-2 text-right font-medium">Closing</th>}
                  {countedBd && <th className="pb-2 text-right font-medium">Closing Amount</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {DENOMS.filter((d) => (openingBd?.[d.key] ?? 0) > 0 || (countedBd?.[d.key] ?? 0) > 0).map((d) => (
                  <tr key={d.key}>
                    <td className="py-1.5">{d.label}</td>
                    {openingBd && <td className="py-1.5 text-right">{openingBd[d.key] ?? 0}</td>}
                    {countedBd && <td className="py-1.5 text-right">{countedBd[d.key] ?? 0}</td>}
                    {countedBd && <td className="py-1.5 text-right">{formatCurrency(d.value * (countedBd[d.key] ?? 0))}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {otherMethods.length > 0 && owner && closed && (
          <ReconcilePanel
            shiftId={shift.id}
            canEdit
            lines={otherMethods.map((m) => ({
              method: m.method,
              count: m.count,
              net: m.net,
              checkedBy: otherChecks[m.method]?.by ?? null,
              checkedAt: otherChecks[m.method]?.at ?? null,
            }))}
          />
        )}
        {otherMethods.length > 0 && !(owner && closed) && (
          <div className="mb-6 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Other Payments (not in the drawer)</div>
            {otherMethods.map((m) => (
              <div key={m.method} className="flex justify-between border-t border-slate-100 py-1.5">
                <span>
                  {PAYMENT_LABEL[m.method] || m.method} ({m.count})
                </span>
                <span>{formatCurrency(m.net)}</span>
              </div>
            ))}
          </div>
        )}

        {owner && drawerPayouts.length > 0 && (
          <div className="mb-6 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Cash Paid Out from Drawer</div>
            {drawerPayouts.map((v) => (
              <div key={v.id} className="flex justify-between border-t border-slate-100 py-1.5">
                <span>
                  {v.number} · {v.payee}
                  {v.purpose ? ` · ${v.purpose}` : ""}
                </span>
                <span>{formatCurrency(v.amount)}</span>
              </div>
            ))}
          </div>
        )}

        {[
          { key: "in", list: voidedInFigures, note: "The figures above stay as they were when the counter was closed. These vouchers were voided later and no cash was added back to any drawer." },
          { key: "out", list: voidedLeftOut, note: "Closed before v0.3.30: these vouchers were voided before the figures were frozen, so they are already left out of the figures above." },
        ].map((g) =>
          g.list.length > 0 ? (
            <div key={g.key} className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="mb-1 font-semibold">Voided after this day was closed</div>
              <div className="mb-2 text-xs">{g.note}</div>
              {g.list.map((v) => (
                <div key={v.id} className="flex justify-between border-t border-amber-200 py-1.5">
                  <span>
                    {v.number} · {v.payee} · {v.voidedAt ? formatDateTime(v.voidedAt) : ""}
                    {v.voidReason ? ` · ${v.voidReason}` : ""}
                  </span>
                  <span>{formatCurrency(v.amount)}</span>
                </div>
              ))}
            </div>
          ) : null
        )}

        {owner && (
          <div className="mb-6 text-sm">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Costs &amp; Estimated Profit (boss only)</div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Total Collected (all methods)</span>
                <span>{formatCurrency(totalCollected)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">− Estimated Cost of Parts Sold</span>
                <span>{formatCurrency(partsCost)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
                <span>Estimated Gross Profit</span>
                <span>{formatCurrency(grossProfit)}</span>
              </div>
              <div className="mt-3 flex justify-between">
                <span className="text-slate-500">Money Paid Out by Voucher (all methods)</span>
                <span>{formatCurrency(paidOutAll)}</span>
              </div>
              {report.otherVouchers.count > 0 && (
                <div className="text-xs text-slate-400">
                  <span>Vouchers paid by other methods or not from the drawer:</span> {report.otherVouchers.count} · {formatCurrency(report.otherVouchers.total)}
                </div>
              )}
              <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
                <span>Net Cash Flow (Collected − Paid Out)</span>
                <span>{formatCurrency(totalCollected - paidOutAll)}</span>
              </div>
              <div className="text-xs text-slate-400">
                Estimates only: parts cost uses each job&apos;s cost prices (prorated by what was paid in this session); labour cost, stock bought earlier and bills not yet paid are not included.
              </div>
            </div>
          </div>
        )}

        <div className="mb-8">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Payments in this session</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Method</th>
                <th className="pb-2 text-right font-medium">Received</th>
                <th className="pb-2 text-right font-medium">Change</th>
                <th className="pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No payments
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="py-2">{formatDateTime(p.paidAt)}</td>
                  <td className="py-2">
                    {p.workOrder.orderNumber} · {p.workOrder.vehicle.plateNumber}
                  </td>
                  <td className="py-2">{p.amount < 0 ? "Refund" : PAYMENT_LABEL[p.method] || p.method}</td>
                  <td className="py-2 text-right">{p.method === "CASH" && p.tendered != null ? formatCurrency(p.tendered) : ""}</td>
                  <td className="py-2 text-right">{p.method === "CASH" && p.tendered != null ? formatCurrency(p.changeGiven ?? 0) : ""}</td>
                  <td className="py-2 text-right font-medium">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-16 text-sm">
          <div>
            <div className="mb-16 border-b border-slate-400"></div>
            <div className="font-medium">Counted by</div>
            <div className="mt-1 text-xs text-slate-500">{shift.closedByName || ""}</div>
          </div>
          <div>
            <div className="mb-16 border-b border-slate-400"></div>
            <div className="font-medium">Checked by (Boss)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
