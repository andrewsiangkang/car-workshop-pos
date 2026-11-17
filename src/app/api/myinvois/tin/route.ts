import { NextResponse } from "next/server";
import { getCurrentUser, requireAuth } from "@/lib/auth";
import { searchTin } from "@/lib/myinvois";
import { ID_TYPES } from "@/lib/einvoice-request";
import { checkBuyerId, maskId } from "@/lib/einvoice2-ids.mjs";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";
import { writeAuditLog } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Staff only: look up a customer's TIN at LHDN from their NRIC / passport / BRN / army ID.
 * Every lookup that reaches LHDN is audited (PDPA): who looked up which ID type, the ID number
 * masked to its last 4 characters, and whether a TIN was found. The full ID and the TIN are not
 * written to the log.
 */
// 【中文】店员按身份证 / 护照 / SSM / 军人证向 LHDN 查顾客的 TIN。每次查询都写审计日志：谁查的、证件类型、只留最后 4 位的证件号码、有没有查到（不记完整号码和 TIN）。
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const actor = await getCurrentUser();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idType = String(body.idType || "NRIC").toUpperCase();
    const idNo = String(body.idNo || "").toUpperCase().replace(/[\s-]/g, "");
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 150);
    if (!(ID_TYPES as readonly string[]).includes(idType)) {
      return NextResponse.json({ error: "Invalid ID type" }, { status: 400 });
    }
    if (checkBuyerId(idType, idNo)) {
      return NextResponse.json(
        {
          error:
            idType === "NRIC"
              ? "NRIC must be the 12 digits of a real IC (no dashes)"
              : idType === "BRN"
                ? "BRN looks wrong (the SSM number, e.g. 202001012345)"
                : "Invalid ID number",
        },
        { status: 400 }
      );
    }
    const r = await searchTin(idType, idNo, name || undefined);
    if (actor) {
      await writeAuditLog({
        actor,
        request,
        action: "MYINVOIS_TIN_LOOKUP",
        entityType: "TinLookup",
        summary: `LHDN TIN lookup by ${idType} ${maskId(idNo)}: ${r.ok ? "found" : "not found"}`,
        details: { idType, idMasked: maskId(idNo), withName: !!name, found: r.ok, ...(r.ok ? {} : { lhdnStatus: r.status }) },
      });
    }
    if (!r.ok) {
      const fe = friendlyMyInvoisError(r.message, { httpStatus: r.status, kind: "tin", fallback: r.message });
      return NextResponse.json(
        { error: formatFriendlyError(fe), messageZh: fe.messageZh },
        { status: r.status === 404 ? 404 : 502 }
      );
    }
    return NextResponse.json({ tin: r.tin });
  } catch (e: unknown) {
    console.error(e);
    return NextResponse.json({ error: (e instanceof Error && e.message) || "Lookup failed" }, { status: 500 });
  }
}
