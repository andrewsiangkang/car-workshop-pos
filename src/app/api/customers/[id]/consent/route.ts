import { NextResponse } from "next/server";
import { requireAuth, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { REMINDER_LANGUAGES } from "@/lib/privacy-customer.mjs";

export const dynamic = "force-dynamic";

/**
 * Record a customer's answer about WhatsApp service reminders (PDPA consent record).
 * Any logged-in user may record it, because staff at the counter are the ones who ask:
 * - {"action": "consent", "language"?: "en" | "zh" | "ms"}: the customer agreed (clears an earlier opt-out);
 * - {"action": "optout"}: the customer does not want reminders (always honoured at once).
 * Every change is in the audit trail with the before / after times.
 * 【中文】记录客户是否同意接收 WhatsApp 保养提醒（PDPA 同意记录）。柜台员工也可以记录；同意可选提醒语言；
 * 拒绝 / 退订立即生效。每次修改都写入审计日志。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const { id } = await params;
    const actor = await getCurrentUser();
    const body = (await request.json().catch(() => null)) ?? {};
    const action = body.action === "consent" ? "consent" : body.action === "optout" ? "optout" : null;
    if (!action) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const language = typeof body.language === "string" && REMINDER_LANGUAGES.includes(body.language) ? body.language : undefined;

    const before = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, reminderConsentAt: true, reminderOptOutAt: true, language: true, anonymisedAt: true },
    });
    if (!before) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    if (before.anonymisedAt) return NextResponse.json({ error: "This customer was anonymised; reminders are off for good" }, { status: 409 });

    const now = new Date();
    const data =
      action === "consent"
        ? { reminderConsentAt: now, reminderOptOutAt: null, ...(language ? { language } : {}) }
        : { reminderOptOutAt: now };
    const after = await prisma.customer.update({
      where: { id },
      data,
      select: { id: true, reminderConsentAt: true, reminderOptOutAt: true, language: true },
    });
    if (actor) {
      await writeAuditLog({
        actor,
        request,
        action: action === "consent" ? "CUSTOMER_REMINDER_CONSENT" : "CUSTOMER_REMINDER_OPT_OUT",
        entityType: "Customer",
        entityId: id,
        summary: action === "consent" ? "Customer agreed to WhatsApp service reminders" : "Customer opted out of WhatsApp service reminders",
        // The reminder language is personal data: only whether it changed (as in CUSTOMER_UPDATED), so
        // the permanent trail keeps no copy of it after anonymising. 【中文】提醒语言只记有没有改变。
        details: {
          before: { reminderConsentAt: before.reminderConsentAt, reminderOptOutAt: before.reminderOptOutAt },
          after: { reminderConsentAt: after.reminderConsentAt, reminderOptOutAt: after.reminderOptOutAt },
          languageChanged: (before.language ?? null) !== (after.language ?? null),
        },
      });
    }
    return NextResponse.json(after);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
}
