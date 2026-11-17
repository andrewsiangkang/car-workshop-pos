import type { Prisma, PrismaClient } from "@prisma/client";
import { anonymisedCustomerData, recordKeepingStart } from "@/lib/privacy-customer.mjs";
import { buyerDataToClear, snapshotsToFreeze } from "@/lib/privacy-freeze.mjs";

type Db = PrismaClient | Prisma.TransactionClient;

/** Buyer details typed on a job (QR form / staff) and the customer's consent to them. */
const BUYER_CLEARED = {
  buyerRequestedAt: null, buyerConsentAt: null, buyerConsentNotice: null, buyerName: null, buyerTin: null,
  buyerIdType: null, buyerIdNo: null, buyerEmail: null, buyerPhone: null, buyerAddress: null,
  buyerPostcode: null, buyerCity: null, buyerStateCode: null,
} as const;

const BUYER_FIELDS = Object.keys(BUYER_CLEARED) as Array<keyof typeof BUYER_CLEARED>;

/** Dates and numbers needed for the record-keeping and retention checks (privacy-customer.mjs). */
export const ORDER_DATES_SELECT = {
  status: true,
  invoiceNumber: true,
  receiptNumber: true,
  createdAt: true,
  invoicedAt: true,
  paidAt: true,
  completedAt: true,
  payments: { select: { paidAt: true } },
  creditNotes: { select: { createdAt: true } },
} as const;

/**
 * Anonymise one customer (call inside a transaction):
 * - first, invoices, receipts and credit notes still inside the record-keeping period that were
 *   issued before v0.3.29 (no frozen particulars yet) get the buyer frozen as it prints today, so
 *   their reprints and e-Invoices keep naming the real buyer (privacy-freeze.mjs);
 * - the customer record: name "Anonymised customer", phone / e-mail / TIN / address / notes removed,
 *   reminders off for good, anonymisedAt set;
 * - their cars: VIN, notes and the next-service reminder removed (plate, make and model stay,
 *   because jobs refer to the car);
 * - buyer details typed on jobs that never became an invoice or receipt;
 * - invoices / receipts (and their credit notes) already past the record-keeping period: the buyer
 *   details typed on the job and the buyer in their snapshots (privacy-freeze.mjs buyerDataToClear).
 * Invoices, receipts, credit notes, payments and amounts are otherwise NOT touched: tax records
 * must be kept 7 years, and issued documents inside that period keep the particulars frozen on them.
 * 【中文】匿名化一位客户（在交易内调用）：先把还在保存期内、v0.3.29 之前开出（没有快照）的单据按今天打印的样子冻结买方，
 * 补印和电子发票仍是原来的买方；然后客户记录去掉个人资料；车辆去掉车架号、备注和保养提醒（保留车牌，因为工单要引用）；
 * 清除从未开发票的工单上的买方资料；已过保存期的发票 / 收据（及其退款单）也清除买方资料和快照里的买方。发票、收据、退款单、付款和金额都不动（税务记录要保存 7 年）。
 */
export async function anonymiseCustomer(db: Db, customerId: string, now: Date) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  const issued = customer
    ? await db.workOrder.findMany({
        where: { customerId, OR: [{ invoiceNumber: { not: null } }, { receiptNumber: { not: null } }] },
        include: { creditNotes: { select: { id: true, createdAt: true, docSnapshot: true } } },
      })
    : [];
  const freeze = customer ? snapshotsToFreeze({ customer, orders: issued, now }) : { orders: [], creditNotes: [] };
  let snapshotsFrozen = 0;
  // Only where there is still no snapshot, so a snapshot written meanwhile is never replaced.
  const noSnapshot = [{ docSnapshot: null }, { docSnapshot: "" }];
  for (const o of freeze.orders) {
    snapshotsFrozen += (await db.workOrder.updateMany({ where: { id: o.id, OR: noSnapshot }, data: { docSnapshot: o.docSnapshot } })).count;
  }
  for (const c of freeze.creditNotes) {
    snapshotsFrozen += (await db.creditNote.updateMany({ where: { id: c.id, OR: noSnapshot }, data: { docSnapshot: c.docSnapshot } })).count;
  }

  await db.customer.update({ where: { id: customerId }, data: anonymisedCustomerData(now) });
  const vehicles = await db.vehicle.updateMany({
    where: { customerId },
    data: { vin: null, notes: null, nextServiceDate: null, nextServiceMileage: null },
  });
  const quotations = await db.workOrder.updateMany({
    where: { customerId, invoiceNumber: null, receiptNumber: null, buyerRequestedAt: { not: null } },
    data: BUYER_CLEARED,
  });
  // Documents past the keeping period keep no personal data (see clearExpiredBuyerData).
  const expired = customer ? await clearExpiredBuyerData(db, customerId, now) : { documents: 0 };
  return {
    snapshotsFrozen,
    vehiclesCleared: vehicles.count,
    quotationsCleared: quotations.count,
    expiredDocumentsCleared: expired.documents,
  };
}

/**
 * Documents past the keeping period keep no personal data: on the customer's invoices / receipts
 * (and their credit notes) that are now past it (privacy-freeze.mjs buyerDataToClear), the buyer
 * typed on the job and the buyer in their snapshots go (seller and car stay). Called when a
 * customer is anonymised, and again later for customers anonymised while their documents were
 * still inside the period (sweepExpiredBuyerData), so that data does not stay for ever. Running it
 * twice changes nothing. Returns how many jobs still held buyer data that is now gone.
 * 【中文】已过保存期的单据不再保留个人资料：清除工单上的买方资料和快照里的买方（卖方和车辆照旧）。匿名化时执行一次，
 * 之后对当时还在保存期内的单据再执行（sweepExpiredBuyerData），个人资料不会永远留着。重复执行不会改变任何东西。
 */
export async function clearExpiredBuyerData(db: Db, customerId: string, now: Date) {
  const issued = await db.workOrder.findMany({
    where: { customerId, OR: [{ invoiceNumber: { not: null } }, { receiptNumber: { not: null } }] },
    include: { creditNotes: { select: { id: true, createdAt: true, docSnapshot: true } } },
  });
  const plan = buyerDataToClear({ orders: issued, now });
  if (!plan.orderIds.length) return { documents: 0 };
  const expired = new Set(plan.orderIds);
  // Only jobs that still hold buyer data are written (and counted).
  const withRequest = issued.filter((o) => expired.has(o.id) && BUYER_FIELDS.some((k) => o[k] !== null && o[k] !== undefined)).map((o) => o.id);
  if (withRequest.length) await db.workOrder.updateMany({ where: { id: { in: withRequest } }, data: BUYER_CLEARED });
  for (const o of plan.orders) await db.workOrder.update({ where: { id: o.id }, data: { docSnapshot: o.docSnapshot } });
  for (const c of plan.creditNotes) await db.creditNote.update({ where: { id: c.id }, data: { docSnapshot: c.docSnapshot } });
  const jobOfNote = new Map(issued.flatMap((o) => o.creditNotes.map((c) => [c.id, o.id] as const)));
  const touched = new Set<string>([
    ...withRequest,
    ...plan.orders.map((o) => o.id),
    ...plan.creditNotes.map((c) => jobOfNote.get(c.id)).filter((id): id is string => !!id),
  ]);
  return { documents: touched.size };
}

/** A snapshot that still names a buyer (snapshots are written by JSON.stringify, no spaces). */
const SNAPSHOT_WITH_BUYER = '"buyer":{';

/**
 * Customers anonymised earlier whose documents have since passed the keeping period: their buyer
 * data is cleared now (clearExpiredBuyerData), one transaction per customer. Only customers that
 * still hold something to clear are read: an issued job dated before the keeping start that still
 * has buyer details typed on it, or a buyer in its snapshot or a credit note's snapshot. Once a
 * customer's expired documents are cleared they drop out, so the work does not grow every year.
 * The candidates are found from the jobs and credit notes (one indexed pass each), not per customer.
 * One customer that fails is logged and skipped (counted in `failed`); the others still run.
 * Runs at server start and with the retention schedule. Returns counts only (for one audit entry
 * without personal data).
 * 【中文】以前已匿名、但单据当时还在保存期内的客户：单据过了保存期后，现在清除买方资料（每位客户一个交易）。
 * 只读取还有东西要清的客户（够旧的已开单工单上还有买方资料，或它 / 它的退款单的快照里还有买方）；清完就不再读取，不会一年比一年慢。
 * 某位客户失败只记录并跳过（计入 failed），其他客户照样清除。服务器启动时和执行保留期限时运行，只返回数量（审计记录不含个人资料）。
 */
export async function sweepExpiredBuyerData(db: PrismaClient, now: Date = new Date()) {
  const since = new Date(recordKeepingStart(now));
  // Necessary for buyerDataToClear (a superset of what it clears): an anonymised customer's invoice
  // or receipt with a document date before the keeping start and no credit note after it.
  const expiredJob: Prisma.WorkOrderWhereInput = {
    AND: [
      { customer: { anonymisedAt: { not: null } } },
      { OR: [{ invoiceNumber: { not: null } }, { receiptNumber: { not: null } }] },
      { OR: [{ createdAt: { lt: since } }, { invoicedAt: { lt: since } }, { paidAt: { lt: since } }] },
      { creditNotes: { none: { createdAt: { gte: since } } } },
    ],
  };
  const holdsBuyer: Prisma.WorkOrderWhereInput = {
    OR: [
      ...BUYER_FIELDS.map((k) => ({ [k]: { not: null } }) as Prisma.WorkOrderWhereInput),
      { docSnapshot: { contains: SNAPSHOT_WITH_BUYER } },
    ],
  };
  const [jobs, notes] = await Promise.all([
    db.workOrder.findMany({ where: { AND: [expiredJob, holdsBuyer] }, select: { customerId: true } }),
    db.creditNote.findMany({
      where: { docSnapshot: { contains: SNAPSHOT_WITH_BUYER }, workOrder: expiredJob },
      select: { workOrder: { select: { customerId: true } } },
    }),
  ]);
  const ids = [...new Set([...jobs.map((j) => j.customerId), ...notes.map((n) => n.workOrder.customerId)])];
  let touchedCustomers = 0;
  let documents = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      // A long-standing fleet customer can have thousands of documents expiring at once.
      const r = await db.$transaction((tx) => clearExpiredBuyerData(tx, id, now), { timeout: 15000 });
      if (r.documents) {
        touchedCustomers++;
        documents += r.documents;
      }
    } catch (e) {
      // No personal data in the log; this customer is tried again at the next start.
      failed++;
      console.error("[privacy] could not clear expired buyer data for one customer", e);
    }
  }
  return { customers: touchedCustomers, documents, failed };
}
