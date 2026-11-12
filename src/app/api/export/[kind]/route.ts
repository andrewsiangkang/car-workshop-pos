import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { toCsv, formatDate, type CsvColumn } from "@/lib/csv-core.mjs";

export const dynamic = "force-dynamic";

const KINDS = ["invoices", "customers", "vehicles", "inventory", "expenses"] as const;
type Kind = (typeof KINDS)[number];
const RANGES = ["month", "quarter", "year", "all"] as const;

// 【中文】按报表页同样的规则算起始日期；"all" 表示不限日期。
function rangeStart(range: string): Date | null {
  const now = new Date();
  if (range === "all") return null;
  if (range === "year") return new Date(now.getFullYear(), 0, 1);
  if (range === "quarter") return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

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
        { key: "invoicedAt", header: "Invoice Date", type: "date" },
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
        { key: "paidAt", header: "Paid Date", type: "date" },
        { key: "eInvoiceStatus", header: "e-Invoice Status" },
      ],
      rows: orders.map((o) => ({
        invoiceNumber: o.invoiceNumber, orderNumber: o.orderNumber, invoicedAt: o.invoicedAt,
        customer: o.customer.name, phone: o.customer.phone, plate: o.vehicle.plateNumber,
        status: o.status, partsAmount: o.partsAmount, laborAmount: o.laborAmount, discount: o.discount,
        taxRate: o.taxRate, taxAmount: o.taxAmount, roundingAdjustment: o.roundingAdjustment,
        totalAmount: o.totalAmount, creditedAmount: o.creditedAmount, paidAmount: o.paidAmount,
        paidAt: o.paidAt, eInvoiceStatus: o.eInvoiceStatus,
      })),
    };
  }

  if (kind === "expenses") {
    const items = await prisma.expense.findMany({
      where: start ? { expenseDate: { gte: start } } : {},
      orderBy: { expenseDate: "asc" },
    });
    return {
      columns: [
        { key: "expenseDate", header: "Date", type: "date" },
        { key: "title", header: "Title" },
        { key: "category", header: "Category" },
        { key: "amount", header: "Amount (RM)", type: "money" },
        { key: "notes", header: "Notes" },
      ],
      rows: items.map((e) => ({ ...e })),
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
        { key: "createdAt", header: "Created", type: "date" },
      ],
      rows: items.map((c) => ({ ...c })),
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
        { key: "nextServiceDate", header: "Next Service Date", type: "date" },
        { key: "nextServiceMileage", header: "Next Service (km)" },
        { key: "notes", header: "Notes" },
      ],
      rows: items.map((v) => ({ ...v, owner: v.customer.name, ownerPhone: v.customer.phone })),
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
    ],
    rows: items.map((i) => ({ ...i })),
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
    const name = `${kind}-${formatDate(new Date())}.csv`;
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
