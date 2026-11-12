import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { searchTin } from "@/lib/myinvois";
import { ID_TYPES } from "@/lib/einvoice-request";
import { friendlyMyInvoisError, formatFriendlyError } from "@/lib/myinvois-errors";

export const dynamic = "force-dynamic";

/** Staff only: look up a customer's TIN at LHDN from their NRIC / passport / BRN / army ID. */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await request.json();
    const idType = String(body.idType || "NRIC").toUpperCase();
    const idNo = String(body.idNo || "").toUpperCase().replace(/[\s-]/g, "");
    const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 150);
    if (!(ID_TYPES as readonly string[]).includes(idType)) {
      return NextResponse.json({ error: "Invalid ID type" }, { status: 400 });
    }
    if (idType === "NRIC" ? !/^\d{12}$/.test(idNo) : !/^[A-Z0-9]{5,20}$/.test(idNo)) {
      return NextResponse.json(
        { error: idType === "NRIC" ? "NRIC must be 12 digits (no dashes)" : "Invalid ID number" },
        { status: 400 }
      );
    }
    const r = await searchTin(idType, idNo, name || undefined);
    if (!r.ok) {
      const fe = friendlyMyInvoisError(r.message, { httpStatus: r.status, kind: "tin", fallback: r.message });
      return NextResponse.json(
        { error: formatFriendlyError(fe), messageZh: fe.messageZh },
        { status: r.status === 404 ? 404 : 502 }
      );
    }
    return NextResponse.json({ tin: r.tin });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || "Lookup failed" }, { status: 500 });
  }
}
