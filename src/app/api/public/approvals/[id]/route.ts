import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
function safeEqualHex(a: string, b: string) {
  const aa = Buffer.from(a, "hex"); const bb = Buffer.from(b, "hex");
  return aa.length === bb.length && aa.length > 0 && timingSafeEqual(aa, bb);
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const token = new URL(request.url).searchParams.get("token") || "";
  const row = await prisma.customerApproval.findUnique({ where: { id }, include: { lines: true, workOrder: { select: { orderNumber: true, vehicle: { select: { plateNumber: true } } } } } });
  if (!row || !row.tokenHash || !token || !safeEqualHex(row.tokenHash, createHash("sha256").update(token).digest("hex")) || row.approvalStatus !== "PENDING" || (row.expiresAt && row.expiresAt < new Date())) return NextResponse.json({ error: "Approval link is invalid or expired" }, { status: 404 });
  return NextResponse.json({ id: row.id, revision: row.revision, orderNumber: row.workOrder.orderNumber, plateNumber: row.workOrder.vehicle.plateNumber, lines: row.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total })) });
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params; const b = await request.json(); const token = String(b.token || "");
    const row = await prisma.customerApproval.findUnique({ where: { id }, include: { lines: true } });
    if (!row || !row.tokenHash || !token || !safeEqualHex(row.tokenHash, createHash("sha256").update(token).digest("hex")) || row.approvalStatus !== "PENDING" || (row.expiresAt && row.expiresAt < new Date())) return NextResponse.json({ error: "Approval link is invalid or expired" }, { status: 404 });
    const decisions = Array.isArray(b.lines) ? b.lines : [];
    const decisionIds = decisions.map((x: { id: string }) => String(x.id));
    if (!decisions.length || decisions.length !== row.lines.length || new Set(decisionIds).size !== row.lines.length || decisions.some((x: { id: string; decision: string }) => !row.lines.some((l) => l.id === x.id) || !["APPROVED", "DECLINED"].includes(x.decision))) return NextResponse.json({ error: "A unique decision is required for every item" }, { status: 400 });
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.customerApproval.updateMany({ where: { id, tokenHash: row.tokenHash, approvalStatus: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { approvalStatus: "PROCESSING" } });
      if (claimed.count !== 1) throw new Error("Approval link has already been used or expired");
      for (const line of decisions) await tx.approvalLine.update({ where: { id: line.id }, data: { decision: line.decision, decidedAt: new Date() } });
      const approved = decisions.filter((x: { decision: string }) => x.decision === "APPROVED").length;
      const status = approved === decisions.length ? "APPROVED" : approved === 0 ? "DECLINED" : "PARTIAL";
      return tx.customerApproval.update({ where: { id }, data: { approvalStatus: status, approvedAt: new Date(), customerName: b.customerName ? String(b.customerName).slice(0,120) : row.customerName }, select: { id: true, revision: true, approvalStatus: true, approvedAt: true } });
    });
    return NextResponse.json(updated);
  } catch { return NextResponse.json({ error: "Unable to record approval" }, { status: 400 }); }
}
