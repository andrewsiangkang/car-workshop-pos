import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { toCsv, type CsvColumn } from "@/lib/csv-core.mjs";
import { myDateKey, myRangeStart } from "@/lib/money-time.mjs";

export const dynamic = "force-dynamic";

const KINDS = ["invoices", "customers", "vehicles", "inventory", "expenses"] as const;
type Kind = (typeof KINDS)[number];
const RANGES = ["month", "quarter", "year", "all"] as const;

// 【中文】按报表页同样的规则算起始日期（马来西亚时间）；"all" 表示不限日期。
function rangeStart(range: string): Date | null {
  return myRangeStart(range, new Date());
}

// Dates go out as Malaysian calendar dates (YYYY-MM-DD) whatever the PC's time zone is; they are
// passed to the CSV writer as text so it cannot shift them again. 【中文】日期按马来西亚日历输出。
const day = (d: Date | string | null | undefined) => (d ? myDateKey(d) : "");

type Built = { columns: CsvColumn[]; rows: Array<Record<string, unknown>> };

async function build(kind: Kind, range: string): Promise<Built> {
  const start = rangeStart(range);

  if (kind === "invoices") {
    const orders = await prisma.workOrder.findMany({
      where: { invoiceNumber: { not: null }, ...(start ? { invoicedAt: { gte: start } } : {}) },
      include: { customer: true, vehicle: true },
      orderBy: { invoicedAt: "asc" },
    });
    return {
      columns: [
        { key: "invoiceNumber", header: "Invoice No" },
        { key: "orderNumber", header: "Job No" },
        { key: "invoicedAt", header: "Invoice Date" },
        { key: "customer", header: "Customer" },
        { key: "phone", header: "Phone" },
        { key: "plate", header: "Plate" },
        { key: "status", header: "Status" },
        { key: "partsAmount", header: "Parts (RM)", type: "money" },
        { key: "laborAmount", header: "Labour (RM)", type: "money" },
        { key: "discount", header: "Discount (RM)", type: "money" },
        { key: "taxRate", header: "SST Rate (%)" },
        { key: "taxAmount", header: "SST (RM)", type: "money" },
        { key: "roundingAdjustment", header: "Rounding (RM)", type: "money" },
        { key: "totalAmount", header: "Total (RM)", type: "money" },
        { key: "creditedAmount", header: "Credited (RM)", type: "money" },
        { key: "paidAmount", header: "Paid (RM)", type: "money" },
        { key: "paidAt", header: "Paid Date" },
        { key: "eInvoiceStatus", header: "e-Invoice Status" },
        { key: "eInvoiceEnv", header: "e-Invoice Environment" },
      ],
      rows: orders.map((o) => ({
        invoiceNumber: o.invoiceNumber, orderNumber: o.orderNumber, invoicedAt: day(o.invoicedAt),
        customer: o.customer.name, phone: o.customer.phone, plate: o.vehicle.plateNumber,
        status: o.status, partsAmount: o.partsAmount, laborAmount: o.laborAmount, discount: o.discount,
        taxRate: o.taxRate, taxAmount: o.taxAmount, roundingAdjustment: o.roundingAdjustment,
        totalAmount: o.totalAmount, creditedAmount: o.creditedAmount, paidAmount: o.paidAmount,
        paidAt: day(o.paidAt), eInvoiceStatus: o.eInvoiceStatus, eInvoiceEnv: o.eInvoiceUuid ? (o.eInvoiceEnv || "production") : "",
      })),
    };
  }

  if (kind === "expenses") {
    // Voided expenses stay in the file (marked VOID) so the export matches the records kept.
    const items = await prisma.expense.findMany({
      where: start ? { expenseDate: { gte: start } } : {},
      orderBy: { expenseDate: "asc" },
    });
    return {
      columns: [
        { key: "expenseDate", header: "Date" },
        { key: "title", header: "Title" },
        { key: "category", header: "Category" },
        { key: "amount", header: "Amount (RM)", type: "money" },
        { key: "status", header: "Status" },
        { key: "voidReason", header: "Void Reason" },
        { key: "notes", header: "Notes" },
      ],
      rows: items.map((e) => ({
        ...e,
        expenseDate: day(e.expenseDate),
        status: e.voidedAt ? `VOID ${day(e.voidedAt)}` : "",
      })),
    };
  }

  if (kind === "customers") {
    const items = await prisma.customer.findMany({ orderBy: { name: "asc" } });
    return {
      columns: [
        { key: "name", header: "Name" },
        { key: "phone", header: "Phone" },
        { key: "email", header: "Email" },
        { key: "tin", header: "TIN" },
        { key: "notes", header: "Notes" },
        { key: "createdAt", header: "Created" },
      ],
      rows: items.map((c) => ({ ...c, createdAt: day(c.createdAt) })),
    };
  }

  if (kind === "vehicles") {
    const items = await prisma.vehicle.findMany({ include: { customer: true }, orderBy: { plateNumber: "asc" } });
    return {
      columns: [
        { key: "plateNumber", header: "Plate" },
        { key: "make", header: "Make" },
        { key: "model", header: "Model" },
        { key: "year", header: "Year" },
        { key: "color", header: "Colour" },
        { key: "vin", header: "VIN" },
        { key: "mileage", header: "Mileage (km)" },
        { key: "owner", header: "Owner" },
        { key: "ownerPhone", header: "Owner Phone" },
        { key: "nextServiceDate", header: "Next Service Date" },
        { key: "nextServiceMileage", header: "Next Service (km)" },
        { key: "notes", header: "Notes" },
      ],
      rows: items.map((v) => ({ ...v, nextServiceDate: day(v.nextServiceDate), owner: v.customer.name, ownerPhone: v.customer.phone })),
    };
  }

  const items = await prisma.inventoryItem.findMany({ orderBy: { name: "asc" } });
  return {
    columns: [
      { key: "name", header: "Name" },
      { key: "sku", header: "SKU" },
      { key: "category", header: "Category" },
      { key: "unit", header: "Unit" },
      { key: "quantityOnHand", header: "Qty On Hand" },
      { key: "costPrice", header: "Cost (RM)", type: "money" },
      { key: "sellingPrice", header: "Selling (RM)", type: "money" },
      { key: "minStockLevel", header: "Min Stock" },
      { key: "notes", header: "Notes" },
      { key: "archivedAt", header: "Archived" },
    ],
    rows: items.map((i) => ({ ...i, archivedAt: day(i.archivedAt) })),
  };
}

// 【中文】导出 CSV（只有老板可用）。导出动作会写进审计日志。
export async function GET(request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { kind } = await params;
  if (!(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "Unknown export type" }, { status: 404 });
  }
  const url = new URL(request.url);
  const asked = url.searchParams.get("range") || "month";
  const range = (RANGES as readonly string[]).includes(asked) ? asked : "month";
  try {
    const { columns, rows } = await build(kind as Kind, range);
    const body = toCsv(columns, rows);
    const actor = await getCurrentUser();
    if (actor) {
      await writeAuditLog({
        actor, request, action: "DATA_EXPORTED", entityType: "Export", entityId: kind,
        summary: `CSV export: ${kind} (${rows.length} rows)`,
        details: { kind, range, rows: rows.length },
      });
    }
    const name = `${kind}-${myDateKey(new Date())}.csv`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
