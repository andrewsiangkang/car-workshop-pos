import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nextSupplierInvoiceNumber, money } from "@/lib/docnumber";
import { categorize, SERVICE_CATEGORY } from "@/lib/supplier-parse";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

class UserError extends Error {}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00+08:00"); // 马来西亚时间
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 【中文】录入供应商发票并自动入库（仅老板）。
 * 1) 供应商不存在就自动建立（方便下次订货）；2) 同一供应商同一发票号不能重复录入；
 * 3) 每个商品：库存里找得到（按 SKU 或同名）就加数量并更新成本价，找不到就新建库存项目并分类；
 * 4) 记录入库流水。全部在一个事务里完成，要么全成功要么全不改。
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const me = await getCurrentUser();
    const b = await request.json();

    const supplierName = text(b.supplierName, 150);
    const invoiceNo = text(b.invoiceNo, 60);
    const invoiceDate = parseDate(b.invoiceDate);
    const dueDate = b.dueDate ? parseDate(b.dueDate) : null;
    if (!supplierName) throw new UserError("Supplier name is required");
    if (!invoiceNo) throw new UserError("Supplier invoice number is required");
    if (!invoiceDate) throw new UserError("Invoice date is required");
    if (!Array.isArray(b.items) || b.items.length === 0) throw new UserError("Add at least one item");
    if (b.items.length > 200) throw new UserError("Too many items");

    type Line = { description: string; sku: string | null; category: string; quantity: number; unitCost: number; total: number; sellingPrice: number | null };
    const lines: Line[] = [];
    for (const raw of b.items as Array<Record<string, unknown>>) {
      const description = text(raw.description, 200);
      const quantity = Number(raw.quantity);
      const unitCost = money(Number(raw.unitCost));
      if (!description) throw new UserError("Every item needs a description");
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) throw new UserError(`Invalid quantity for “${description}”`);
      if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10000000) throw new UserError(`Invalid unit cost for “${description}”`);
      const sp = Number(raw.sellingPrice);
      lines.push({
        description,
        sku: text(raw.sku, 60) || null,
        category: text(raw.category, 60) || categorize(description),
        quantity,
        unitCost,
        total: money(quantity * unitCost),
        sellingPrice: Number.isFinite(sp) && sp > 0 ? money(sp) : null,
      });
    }
    const subtotal = money(lines.reduce((s, l) => s + l.total, 0));
    const taxAmount = Math.max(0, money(Number(b.taxAmount) || 0));
    const totalAmount = money(subtotal + taxAmount);

    const result = await prisma.$transaction(async (tx) => {
      // 供应商：按名字（不分大小写）找，没有就新建
      const suppliers = await tx.supplier.findMany();
      let supplier = suppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase());
      if (!supplier) {
        supplier = await tx.supplier.create({
          data: { name: supplierName, phone: text(b.supplierPhone, 50) || null, address: text(b.supplierAddress, 300) || null },
        });
      }

      const dup = await tx.supplierInvoice.findFirst({ where: { supplierId: supplier.id, invoiceNo } });
      if (dup) throw new UserError(`Invoice ${invoiceNo} from ${supplier.name} is already recorded (${dup.internalNo})`);

      const internalNo = await nextSupplierInvoiceNumber(tx);
      const invoice = await tx.supplierInvoice.create({
        data: {
          internalNo,
          invoiceNo,
          invoiceDate,
          dueDate,
          supplierId: supplier.id,
          subtotal,
          taxAmount,
          totalAmount,
          notes: text(b.notes, 500) || null,
          imageUrl: typeof b.imageUrl === "string" && b.imageUrl.startsWith("/api/files/") ? b.imageUrl : null,
          createdById: me?.id ?? null,
        },
      });

      // Archived items are matched too: new stock for an archived part brings it back into use.
      const stock = await tx.inventoryItem.findMany({
        select: { id: true, name: true, sku: true, category: true, costPrice: true, sellingPrice: true, archivedAt: true },
      });
      let created = 0;
      let updated = 0;
      let serviceLines = 0;
      const priceChanges: Array<{ inventoryItemId: string; name: string; cost: { from: number; to: number }; selling: { from: number; to: number } | null }> = [];
      const restoredFromArchive: string[] = [];
      for (const l of lines) {
        // Delivery / labour / service charges are costs, not goods: record them on the
        // invoice only, never as stock that could be sold (was a bug).
        if (l.category === SERVICE_CATEGORY) {
          await tx.supplierInvoiceItem.create({
            data: {
              description: l.description,
              sku: l.sku,
              category: l.category,
              quantity: l.quantity,
              unitCost: l.unitCost,
              total: l.total,
              invoiceId: invoice.id,
              inventoryItemId: null,
            },
          });
          serviceLines += 1;
          continue;
        }
        // An exact SKU wins; otherwise the same name, an item in use before an archived one (an
        // archived item is often the older row that a new item of the same name replaced).
        // 【中文】先按 SKU 精确匹配；没有再按同名找，优先在用的商品，最后才是已归档的旧商品。
        const skuKey = l.sku?.toLowerCase();
        const nameKey = l.description.toLowerCase();
        const bySku = skuKey ? stock.find((s) => s.sku && s.sku.toLowerCase() === skuKey) : undefined;
        const byName = (archived: boolean) => stock.find((s) => !!s.archivedAt === archived && s.name.toLowerCase() === nameKey);
        let item = bySku ?? byName(false) ?? byName(true);
        // Prices before this line changed them, kept on the invoice line so a void can put them
        // back (prevSellingPrice only when this line sets a selling price). Null = item created here.
        // 【中文】记下这一行改价之前的成本价 / 售价（只有填了售价才记售价），作废时可以放回。
        let prevCostPrice: number | null = null;
        let prevSellingPrice: number | null = null;
        if (item) {
          prevCostPrice = item.costPrice;
          prevSellingPrice = l.sellingPrice ? item.sellingPrice : null;
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: {
              quantityOnHand: { increment: l.quantity },
              costPrice: l.unitCost,
              ...(item.category ? {} : { category: l.category }),
              ...(l.sellingPrice ? { sellingPrice: l.sellingPrice } : {}),
              ...(item.archivedAt ? { archivedAt: null } : {}),
            },
          });
          if (item.archivedAt) restoredFromArchive.push(item.id);
          priceChanges.push({
            inventoryItemId: item.id,
            name: item.name,
            cost: { from: item.costPrice, to: l.unitCost },
            selling: l.sellingPrice ? { from: item.sellingPrice, to: l.sellingPrice } : null,
          });
          // Later lines for the same item see the prices this line set.
          item.costPrice = l.unitCost;
          if (l.sellingPrice) item.sellingPrice = l.sellingPrice;
          item.archivedAt = null;
          updated += 1;
        } else {
          const made = await tx.inventoryItem.create({
            data: {
              name: l.description,
              sku: l.sku && !stock.some((s) => s.sku && s.sku.toLowerCase() === l.sku!.toLowerCase()) ? l.sku : null,
              category: l.category,
              quantityOnHand: l.quantity,
              costPrice: l.unitCost,
              // 没填售价时默认按成本加 30%，之后可在库存页修改
              sellingPrice: l.sellingPrice ?? money(l.unitCost * 1.3),
            },
            select: { id: true, name: true, sku: true, category: true, costPrice: true, sellingPrice: true, archivedAt: true },
          });
          item = made;
          stock.push(made);
          created += 1;
        }
        await tx.stockMovement.create({
          data: { type: "IN", quantity: l.quantity, notes: `Supplier invoice ${supplier.name} ${invoiceNo}`, inventoryItemId: item.id },
        });
        await tx.supplierInvoiceItem.create({
          data: {
            description: l.description,
            sku: l.sku,
            category: l.category,
            quantity: l.quantity,
            unitCost: l.unitCost,
            total: l.total,
            invoiceId: invoice.id,
            inventoryItemId: item.id,
            prevCostPrice,
            prevSellingPrice,
          },
        });
      }
      return { id: invoice.id, internalNo, supplierId: supplier.id, created, updated, serviceLines, priceChanges, restoredFromArchive };
    });
    if (me) await writeAuditLog({ actor: me, request, action: "SUPPLIER_INVOICE_CREATED", entityType: "SupplierInvoice", entityId: result.id, summary: `Supplier invoice ${invoiceNo} recorded`, details: { internalNo: result.internalNo, supplierId: result.supplierId, subtotal, taxAmount, totalAmount, itemCount: lines.length, stockItemsCreated: result.created, stockItemsUpdated: result.updated, priceChanges: result.priceChanges, restoredFromArchive: result.restoredFromArchive } });
    return NextResponse.json(
      { id: result.id, internalNo: result.internalNo, supplierId: result.supplierId, created: result.created, updated: result.updated, serviceLines: result.serviceLines },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Failed to save supplier invoice" }, { status: 500 });
  }
}
