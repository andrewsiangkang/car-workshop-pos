/**
 * Pure counter (cash drawer) maths. No database here, so the browser can use it too.
 *
 * Expected cash in the drawer at close
 *   = opening float
 *   + CASH payments        (amount applied to the bill = cash handed over minus change given back)
 *   - CASH refunds         (refunds are stored as negative payments)
 *   - CASH paid out        (payment vouchers paid from the drawer: suppliers, rent, small purchases)
 * Card / Touch 'n Go / bank transfer never enter the drawer, so they are listed
 * separately and are NOT part of the shortage / overage.
 *
 * Variance = counted cash - expected cash.  Negative = SHORT, positive = OVER.
 *
 * The code lives in money-counter.mjs (pure, tested by node --test); this file keeps the
 * import path and types the rest of the app uses.
 * 【中文】收银柜计算：实际代码在 money-counter.mjs（纯函数，有测试），这里只是转出，保持原来的引用路径。
 */
export {
  computeSummary,
  varianceOf,
  varianceKind,
  myDay,
  DENOMS,
  parseBreakdown,
  breakdownTotal,
  breakdownFromInputs,
  depositOf,
  NON_CASH_METHODS,
  parseReconciled,
  estimatePartsCost,
  collectedTotals,
  buildClosingSnapshot,
  readClosingSnapshot,
} from "@/lib/money-counter.mjs";
export type {
  PayRow,
  MethodLine,
  ShiftSummary,
  VarianceKind,
  Breakdown,
  Reconciled,
  ClosingSnapshot,
  SnapshotPayout,
} from "@/lib/money-counter.mjs";
