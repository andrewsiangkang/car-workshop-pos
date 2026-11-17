import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { findCustomerByPhone } from "@/lib/customer-lookup";
import { customerPhoneKey } from "@/lib/customer-match.mjs";
import { MY_STATES } from "@/lib/my-states";
import { validateCustomerFields } from "@/lib/privacy-customer.mjs";
import { auditFieldChanges } from "@/lib/privacy-audit.mjs";

export const dynamic = "force-dynamic";

const EDITABLE = ["name", "phone", "email", "tin", "address", "postcode", "city", "stateCode", "notes", "language"] as const;

/**
 * Correct a customer's details (boss only, PDPA right of correction). Only the fields sent are
 * changed. Invoices issued since v0.3.29 keep the particulars frozen on the day they were issued.
 * The audit entry refers to the customer by its id: the name, notes, postcode, city, state and
 * reminder language are recorded only as "changed", contact and ID details only by their last 4
 * characters, so the hash-chained audit
 * trail (which can never be edited) does not become a second copy of the record that survives
 * an anonymisation.
 * 【中文】更正客户资料（老板专用，PDPA 更正权）。只改送来的栏位；v0.3.29 起开出的发票保留开出当天的资料。
 * 审计记录用客户编号：名字、备注、邮编、城市、州属和提醒语言只记「已修改」，电话、电邮、TIN、地址只记最后 4 位（审计日志不能修改，不能成为第二份客户资料）。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOwner();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const body = (await request.json().catch(() => null)) ?? {};
    const input: Record<string, unknown> = {};
    for (const k of EDITABLE) if (Object.prototype.hasOwnProperty.call(body, k)) input[k] = body[k];
    if (!Object.keys(input).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const checked = validateCustomerFields(input, { stateCodes: Object.keys(MY_STATES) });
    if (!checked.ok) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 });

    const before = await prisma.customer.findUnique({ where: { id } });
    if (!before) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    if (before.anonymisedAt) return NextResponse.json({ error: "This customer was anonymised; the record can no longer be edited" }, { status: 409 });

    const data = checked.data;
    if (data.phone !== undefined) {
      const key = customerPhoneKey(data.phone);
      // Same number written another way ("012-345 6789" = "0123456789"), or still no phone: unchanged.
      if (key === customerPhoneKey(before.phone)) delete data.phone;
      // A phone already on file for another customer would make work orders pick the wrong one.
      else if (key) {
        const other = await findCustomerByPhone(prisma, key);
        if (other && other.id !== id) return NextResponse.json({ error: "A customer with this phone already exists" }, { status: 409 });
      }
    }
    const updated = await prisma.customer.update({ where: { id }, data });
    const diff = auditFieldChanges(before as unknown as Record<string, unknown>, data, {
      masked: ["phone", "email", "tin", "address"],
      opaque: ["name", "notes", "postcode", "city", "stateCode", "language"],
    });
    if (actor && diff.changedFields.length) {
      await writeAuditLog({
        actor,
        request,
        action: "CUSTOMER_UPDATED",
        entityType: "Customer",
        entityId: id,
        summary: `Customer details corrected: ${diff.changedFields.join(", ")}`,
        details: diff,
      });
    }
    return NextResponse.json(updated);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
