"use client";

import { DENOMS, breakdownFromInputs, breakdownTotal } from "@/lib/counter-calc";
import { formatCurrency } from "@/lib/utils";

export type CountInputs = Record<string, string>;

/** Total (RM) of the notes / coins typed into a DenominationCounter. */
export function countsTotal(inputs: CountInputs) {
  return breakdownTotal(breakdownFromInputs(inputs));
}

/**
 * Count the drawer by notes and coins: type how many of each (e.g. RM100 x 3).
 * Shows each line's value and the grand total. Only whole numbers are accepted.
 */
export function DenominationCounter({
  counts,
  onChange,
}: {
  counts: CountInputs;
  onChange: (next: CountInputs) => void;
}) {
  const total = countsTotal(counts);
  const pieces = Object.values(breakdownFromInputs(counts)).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Note / Coin</th>
            <th className="px-3 py-2 text-right font-medium">How many</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {DENOMS.map((d) => {
            const n = parseInt(counts[d.key] ?? "", 10);
            const line = Number.isFinite(n) && n > 0 ? Math.round(d.value * 100) * n / 100 : 0;
            return (
              <tr key={d.key}>
                <td className="px-3 py-1.5 font-medium text-slate-700">{d.label}</td>
                <td className="px-3 py-1.5 text-right">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={counts[d.key] ?? ""}
                    onChange={(e) => onChange({ ...counts, [d.key]: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) })}
                    placeholder="0"
                    className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right text-sm outline-none focus:border-blue-500"
                  />
                </td>
                <td className="px-3 py-1.5 text-right text-slate-600">{line > 0 ? formatCurrency(line) : "-"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right text-xs font-normal text-slate-500">{pieces}</td>
            <td className="px-3 py-2 text-right">{formatCurrency(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
