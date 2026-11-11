import { prisma } from "@/lib/prisma";

type Field = "orderNumber" | "quotationNumber" | "invoiceNumber" | "receiptNumber";

function localDatePart() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${m}${day}`;
}

/** Sequential number per day, e.g. WO20261110001 */
export async function nextDocNumber(
  prefix: "WO" | "QT" | "INV" | "RC",
  field: Field
) {
  const base = `${prefix}${localDatePart()}`;
  const last = await prisma.workOrder.findFirst({
    where: { [field]: { startsWith: base } },
    orderBy: { [field]: "desc" },
    select: { [field]: true },
  });
  const lastVal = last ? ((last as Record<string, string | null>)[field] ?? "") : "";
  const seq = lastVal ? parseInt(lastVal.slice(base.length), 10) || 0 : 0;
  return `${base}${String(seq + 1).padStart(3, "0")}`;
}
