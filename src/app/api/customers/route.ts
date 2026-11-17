import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { findCustomerByPhone } from "@/lib/customer-lookup";
import { MY_STATES } from "@/lib/my-states";
import { validateCustomerFields } from "@/lib/privacy-customer.mjs";

export async function POST(request: Request) {
  const __denied = await requireAuth();
  if (__denied) return __denied;
  try {
    const actor = await getCurrentUser();
    const b = (await request.json().catch(() => null)) ?? {};
    // Name and phone are required. The phone is saved in the same matching form a work order
    // uses ("012-345 6789" -> "0123456789"), so the customer is found again when a job is opened;
    // "N/A" / "-" are not phone numbers. The optional address follows LHDN's limits (address 150,
    // city 50, 5-digit postcode, state from the list), so it can go on invoices as typed.
    // 【中文】名字和电话必填；电话按工单同样的格式保存。地址按 LHDN 上限校验，之后开发票时会带入。
    const checked = validateCustomerFields(
      {
        name: b.name, phone: b.phone, email: b.email, tin: b.tin, notes: b.notes,
        address: b.address, postcode: b.postcode, city: b.city, stateCode: b.stateCode, language: b.language,
      },
      { stateCodes: Object.keys(MY_STATES), all: true, phoneRequired: true }
    );
    if (!checked.ok) return NextResponse.json({ error: checked.error, field: checked.field }, { status: 400 });
    const data = checked.data as Record<string, string | null> & { name: string; phone: string };
    const dup = await findCustomerByPhone(prisma, data.phone);
    if (dup) return NextResponse.json({ error: "A customer with this phone already exists" }, { status: 409 });
    // Ticked only when the customer agreed to WhatsApp service reminders (PDPA consent record).
    const consent = b.reminderConsent === true || b.reminderConsent === "on";
    const c = await prisma.customer.create({
      data: { ...data, reminderConsentAt: consent ? new Date() : null },
    });
    if (actor) {
      await writeAuditLog({
        actor, request, action: "CUSTOMER_CREATED", entityType: "Customer", entityId: c.id,
        summary: `Customer record created`,
        // The reminder language is personal data: only whether one is set (as in CUSTOMER_UPDATED), so
        // the permanent trail keeps no copy of it after anonymising. 【中文】提醒语言只记有没有设定。
        details: { withAddress: !!c.address, reminderConsent: consent, withLanguage: !!c.language },
      });
    }
    return NextResponse.json(c, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
