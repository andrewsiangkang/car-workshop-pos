import { NextResponse } from "next/server";
import { requireOwner, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { calculateMalaysiaStatutory, type PayrollStatutoryProfile } from "@/lib/payroll-statutory";
import { malaysiaPayrollMonthRange } from "@/lib/payroll-period";

export const dynamic = "force-dynamic";
const BASIS = ["LABOR", "PARTS", "GROSS_PROFIT", "TOTAL"] as const;
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const [employees, runs] = await Promise.all([
    prisma.user.findMany({ where: { role: "TECHNICIAN", disabledAt: null }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, payrollRule: true } }),
    prisma.payrollRun.findMany({ orderBy: { periodKey: "desc" }, take: 18, include: { entries: { orderBy: [{ employeeName: "asc" }, { createdAt: "asc" }], include: { workOrder: { select: { orderNumber: true } } } } } }),
  ]);
  return NextResponse.json({ employees, runs });
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "save-rule") {
      const userId = String(body.userId || "");
      const basis = String(body.basis || "LABOR");
      const rate = Number(body.commissionRate);
      const basicSalary = Number(body.basicSalary || 0);
      const isActive = body.isActive === true;
      if (!userId || !BASIS.includes(basis as typeof BASIS[number]) || !Number.isFinite(rate) || rate < 0 || rate > 100 || !Number.isFinite(basicSalary) || basicSalary < 0) {
        return NextResponse.json({ error: "Invalid employee commission settings" }, { status: 400 });
      }
      const employee = await prisma.user.findFirst({ where: { id: userId, role: "TECHNICIAN", disabledAt: null }, select: { id: true, name: true } });
      if (!employee) return NextResponse.json({ error: "Select an active technician" }, { status: 400 });
      const { rule, invalidatedDraftRows } = await prisma.$transaction(async (tx) => {
        const savedRule = await tx.payrollCommissionRule.upsert({ where: { userId }, create: { userId, basis, commissionRate: rate, basicSalary: money(basicSalary), isActive }, update: { basis, commissionRate: rate, basicSalary: money(basicSalary), isActive } });
        // A draft contains a snapshot of the old commission rule. Never allow that stale
        // draft to be approved after the owner changes the employee's rule.
        const draftRows = await tx.payrollEntry.findMany({ where: { userId, workOrderId: null, payrollRun: { is: { status: "DRAFT" } } }, select: { id: true } });
        if (draftRows.length) await tx.payrollEntry.updateMany({ where: { id: { in: draftRows.map((row) => row.id) } }, data: { statutoryReviewed: false, statutoryStatus: "RULE_CHANGED" } });
        return { rule: savedRule, invalidatedDraftRows: draftRows.length };
      });
      await writeAuditLog({ actor, request, action: "PAYROLL_RULE_UPDATED", entityType: "PayrollCommissionRule", entityId: rule.id, summary: `Payroll rule updated for ${employee.name}`, details: { basis, commissionRate: rate, basicSalary, isActive, invalidatedDraftRows } });
      return NextResponse.json({ ...rule, invalidatedDraftRows });
    }

    if (body.action === "save-statutory-profile") {
      const userId = String(body.userId || "");
      const epfCategory = String(body.epfCategory || "");
      const socsoCategory = String(body.socsoCategory || "");
      const socsoSkbbk = String(body.socsoSkbbk || "OFF");
      const taxResidency = String(body.taxResidency || "RESIDENT");
      const taxCategory = String(body.taxCategory || "SINGLE");
      const numericFields = ["qualifyingChildren", "priorGrossYtd", "priorEpfYtd", "priorPcbYtd", "priorZakatYtd", "priorSocsoYtd", "taxReliefYtd", "taxReliefMonthly", "zakatMonthly"] as const;
      const values = Object.fromEntries(numericFields.map((key) => [key, Number(body[key] ?? 0)])) as Record<typeof numericFields[number], number>;
      const allowedEpf = ["MALAYSIAN_UNDER_60", "MALAYSIAN_60_PLUS", "PR_UNDER_60", "PR_60_PLUS", "FOREIGN", "NONE"];
      const allowedSocso = ["FIRST", "SECOND", "FOREIGN", "NONE"];
      if (!userId || !allowedEpf.includes(epfCategory) || !allowedSocso.includes(socsoCategory) || !["ON", "OFF"].includes(socsoSkbbk) || !["RESIDENT", "NON_RESIDENT"].includes(taxResidency) || !["SINGLE", "MARRIED_SPOUSE_NOT_WORKING", "MARRIED_SPOUSE_WORKING"].includes(taxCategory) || Object.values(values).some((v) => !Number.isFinite(v) || v < 0) || values.qualifyingChildren > 20 || !Number.isInteger(values.qualifyingChildren)) {
        return NextResponse.json({ error: "Invalid statutory employee profile" }, { status: 400 });
      }
      const employee = await prisma.user.findFirst({ where: { id: userId, role: "TECHNICIAN", disabledAt: null }, select: { id: true, name: true } });
      if (!employee) return NextResponse.json({ error: "Select an active technician" }, { status: 400 });
      const { rule, draftRowsInvalidated } = await prisma.$transaction(async (tx) => {
        const savedRule = await tx.payrollCommissionRule.upsert({
          where: { userId },
          create: { userId, isActive: false, statutoryProfileComplete: true, epfCategory, socsoCategory, socsoSkbbk, eisEligible: body.eisEligible === true, taxResidency, taxCategory, disabledSelf: body.disabledSelf === true, disabledSpouse: body.disabledSpouse === true, ...values },
          update: { statutoryProfileComplete: true, epfCategory, socsoCategory, socsoSkbbk, eisEligible: body.eisEligible === true, taxResidency, taxCategory, disabledSelf: body.disabledSelf === true, disabledSpouse: body.disabledSpouse === true, ...values },
        });
        const draftSummaryRows = await tx.payrollEntry.findMany({ where: { userId, workOrderId: null, payrollRun: { is: { status: "DRAFT" } } }, select: { id: true, statutoryStatus: true } });
        // Preserve RULE_CHANGED: updating a tax profile must not hide a stale commission snapshot.
        const profileChangedIds = draftSummaryRows.filter((row) => row.statutoryStatus !== "RULE_CHANGED").map((row) => row.id);
        if (profileChangedIds.length) await tx.payrollEntry.updateMany({ where: { id: { in: profileChangedIds } }, data: { statutoryReviewed: false, statutoryStatus: "PROFILE_CHANGED" } });
        return { rule: savedRule, draftRowsInvalidated: draftSummaryRows.length };
      });
      await writeAuditLog({ actor, request, action: "PAYROLL_STATUTORY_PROFILE_UPDATED", entityType: "PayrollCommissionRule", entityId: rule.id, summary: `Statutory payroll profile updated for ${employee.name}`, details: { epfCategory, socsoCategory, socsoSkbbk, eisEligible: body.eisEligible === true, taxResidency, taxCategory, qualifyingChildren: values.qualifyingChildren, draftRowsInvalidated } });
      return NextResponse.json({ ok: true, profileComplete: true });
    }

    if (body.action === "generate") {
      const periodKey = String(body.periodKey || "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) return NextResponse.json({ error: "Choose a valid payroll month" }, { status: 400 });
      const [year] = periodKey.split("-").map(Number);
      const { startAt, endAt } = malaysiaPayrollMonthRange(periodKey);
      const rules = await prisma.payrollCommissionRule.findMany({ where: { isActive: true }, include: { user: { select: { id: true, name: true } } } });
      if (!rules.length) return NextResponse.json({ error: "No active employee commission rules. Configure employees first." }, { status: 400 });
      const priorPaidEntries = await prisma.payrollEntry.findMany({
        where: { userId: { in: rules.map((rule) => rule.userId) }, payrollRun: { is: { status: "PAID", periodKey: { gte: `${year}-01`, lt: periodKey } } } },
        select: { userId: true, commissionAmount: true, basicSalary: true, allowance: true, epfEmployee: true, socsoEmployee: true, pcb: true, zakat: true, taxRelief: true },
      });
      const priorYtd = new Map<string, { gross: number; epf: number; socso: number; pcb: number; zakat: number; taxRelief: number }>();
      for (const row of priorPaidEntries) {
        const total = priorYtd.get(row.userId) || { gross: 0, epf: 0, socso: 0, pcb: 0, zakat: 0, taxRelief: 0 };
        total.gross += row.commissionAmount + row.basicSalary + row.allowance;
        total.epf += row.epfEmployee; total.socso += row.socsoEmployee; total.pcb += row.pcb; total.zakat += row.zakat; total.taxRelief += row.taxRelief;
        priorYtd.set(row.userId, total);
      }
      const existing = await prisma.payrollRun.findUnique({ where: { periodKey } });
      if (existing && existing.status !== "DRAFT") return NextResponse.json({ error: "This payroll has already been approved or paid and cannot be regenerated" }, { status: 409 });
      const workOrders = await prisma.workOrder.findMany({
        where: { status: "COMPLETED", completedAt: { gte: startAt, lt: endAt }, assignedToId: { in: rules.map((r) => r.userId) } },
        include: { items: true }, orderBy: { completedAt: "asc" },
      });
      const previouslyPaidOrLocked = await prisma.payrollEntry.findMany({ where: { workOrderId: { in: workOrders.map((w) => w.id) }, ...(existing ? { payrollRunId: { not: existing.id } } : {}) }, select: { workOrderId: true } });
      const lockedIds = new Set(previouslyPaidOrLocked.map((x) => x.workOrderId).filter(Boolean));
      const run = await prisma.$transaction(async (tx) => {
        const payrollRun = existing
          ? await tx.payrollRun.update({ where: { id: existing.id }, data: { startAt, endAt, totalAmount: 0 } })
          : await tx.payrollRun.create({ data: { periodKey, startAt, endAt } });
        await tx.payrollEntry.deleteMany({ where: { payrollRunId: payrollRun.id } });
        const entries: Array<{ payrollRunId: string; userId: string; employeeName: string; basis: string; basisAmount: number; commissionRate: number; commissionAmount: number; basicSalary: number; totalAmount: number; zakat?: number; taxRelief?: number; workOrderId?: string; statutoryStatus?: string; statutoryReviewed?: boolean; statutoryDetails?: string | null; epfEmployee?: number; epfEmployer?: number; socsoEmployee?: number; socsoEmployer?: number; eisEmployee?: number; eisEmployer?: number; pcb?: number }> = [];
        for (const rule of rules) {
          // Always create one employee summary row. It is the single place for monthly
          // allowances, deductions and statutory contributions, even for commission-only staff.
          entries.push({ payrollRunId: payrollRun.id, userId: rule.userId, employeeName: rule.user.name, basis: rule.basis, basisAmount: 0, commissionRate: rule.commissionRate, commissionAmount: 0, basicSalary: money(rule.basicSalary), zakat: money(rule.zakatMonthly), taxRelief: money(rule.taxReliefMonthly), totalAmount: money(rule.basicSalary - rule.zakatMonthly), statutoryStatus: rule.statutoryProfileComplete ? "CALCULATED_REVIEW_REQUIRED" : "PROFILE_REQUIRED" });
        }
        for (const wo of workOrders) {
          if (!wo.assignedToId || lockedIds.has(wo.id)) continue;
          const rule = rules.find((r) => r.userId === wo.assignedToId);
          if (!rule || rule.commissionRate <= 0) continue;
          const labor = wo.items.filter((i) => i.type === "LABOR").reduce((sum, i) => sum + i.total, 0);
          const parts = wo.items.filter((i) => i.type === "PART").reduce((sum, i) => sum + i.total, 0);
          const grossProfit = wo.items.reduce((sum, i) => sum + i.total - i.costPrice * i.quantity, 0);
          const total = Math.max(0, wo.totalAmount - wo.creditedAmount);
          const base = rule.basis === "LABOR" ? labor : rule.basis === "PARTS" ? parts : rule.basis === "GROSS_PROFIT" ? grossProfit : total;
          // Allocate invoice discounts and credit notes proportionally to line-based commission bases.
          const itemSubtotal = wo.items.reduce((sum, item) => sum + item.total, 0);
          const discountRatio = itemSubtotal > 0 ? Math.max(0, (itemSubtotal - wo.discount) / itemSubtotal) : 0;
          const creditRatio = wo.totalAmount > 0 ? Math.max(0, total / wo.totalAmount) : 0;
          // Commission accrues only on the portion of the net invoice actually collected.
          const collectionRatio = total > 0 ? Math.min(1, Math.max(0, wo.paidAmount / total)) : 0;
          const adjustedBase = rule.basis === "TOTAL" ? total : Math.max(0, base) * discountRatio * creditRatio;
          const basisAmount = money(adjustedBase * collectionRatio);
          const commissionAmount = money(basisAmount * rule.commissionRate / 100);
          if (commissionAmount <= 0) continue;
          entries.push({ payrollRunId: payrollRun.id, userId: rule.userId, employeeName: rule.user.name, basis: rule.basis, basisAmount, commissionRate: rule.commissionRate, commissionAmount, basicSalary: 0, totalAmount: commissionAmount, workOrderId: wo.id });
        }
        // Calculate statutory preview once per employee on consolidated monthly remuneration.
        // It is stored on the employee summary row, never repeated on each Work Order row.
        for (const rule of rules) {
          const summary = entries.find((entry) => entry.userId === rule.userId && !entry.workOrderId);
          if (!summary) continue;
          const commissionTotal = money(entries.filter((entry) => entry.userId === rule.userId && entry.workOrderId).reduce((sum, entry) => sum + entry.commissionAmount, 0));
          const grossWages = money(summary.basicSalary + commissionTotal);
          if (!rule.statutoryProfileComplete) {
            summary.statutoryStatus = "PROFILE_REQUIRED";
            summary.totalAmount = money(summary.basicSalary);
            continue;
          }
          const statutory = calculateMalaysiaStatutory({
            grossWages,
            periodKey,
            profile: {
              statutoryProfileComplete: rule.statutoryProfileComplete,
              epfCategory: rule.epfCategory as PayrollStatutoryProfile["epfCategory"],
              socsoCategory: rule.socsoCategory as PayrollStatutoryProfile["socsoCategory"],
              socsoSkbbk: rule.socsoSkbbk as PayrollStatutoryProfile["socsoSkbbk"],
              eisEligible: rule.eisEligible,
              taxResidency: rule.taxResidency as PayrollStatutoryProfile["taxResidency"],
              taxCategory: rule.taxCategory as PayrollStatutoryProfile["taxCategory"],
              qualifyingChildren: rule.qualifyingChildren,
              disabledSelf: rule.disabledSelf,
              disabledSpouse: rule.disabledSpouse,
              priorGrossYtd: rule.priorGrossYtd + (priorYtd.get(rule.userId)?.gross || 0),
              priorEpfYtd: rule.priorEpfYtd + (priorYtd.get(rule.userId)?.epf || 0),
              priorPcbYtd: rule.priorPcbYtd + (priorYtd.get(rule.userId)?.pcb || 0),
              priorZakatYtd: rule.priorZakatYtd + (priorYtd.get(rule.userId)?.zakat || 0),
              priorSocsoYtd: rule.priorSocsoYtd + (priorYtd.get(rule.userId)?.socso || 0),
              taxReliefYtd: rule.taxReliefYtd + (priorYtd.get(rule.userId)?.taxRelief || 0),
              taxReliefMonthly: summary.taxRelief ?? 0,
              zakatMonthly: rule.zakatMonthly ?? 0,
            },
          });
          if (statutory) {
            Object.assign(summary, {
              epfEmployee: statutory.epfEmployee, epfEmployer: statutory.epfEmployer,
              socsoEmployee: statutory.socsoEmployee, socsoEmployer: statutory.socsoEmployer,
              eisEmployee: statutory.eisEmployee, eisEmployer: statutory.eisEmployer, pcb: statutory.pcb,
              statutoryStatus: "CALCULATED_REVIEW_REQUIRED",
              statutoryDetails: JSON.stringify(statutory),
            });
            summary.totalAmount = money(summary.basicSalary - (summary.zakat ?? 0) - statutory.epfEmployee - statutory.socsoEmployee - statutory.eisEmployee - statutory.pcb);
          } else {
            summary.statutoryStatus = "MANUAL_REVIEW";
          }
        }
        if (entries.length) await tx.payrollEntry.createMany({ data: entries });
        const totalAmount = money(entries.reduce((sum, e) => sum + e.totalAmount, 0));
        return tx.payrollRun.update({ where: { id: payrollRun.id }, data: { totalAmount }, include: { entries: true } });
      });
      await writeAuditLog({ actor, request, action: "PAYROLL_DRAFT_GENERATED", entityType: "PayrollRun", entityId: run.id, summary: `Payroll draft generated for ${periodKey}`, details: { periodKey, employeeCount: new Set(run.entries.map((e) => e.userId)).size, entryCount: run.entries.length, totalAmount: run.totalAmount } });
      return NextResponse.json(run, { status: 201 });
    }

    if (body.action === "adjust-entry") {
      const entryId = String(body.entryId || "");
      const allowance = Number(body.allowance || 0);
      const deduction = Number(body.deduction || 0);
      const zakat = Number(body.zakat ?? 0);
      const statutory = {
        epfEmployee: Number(body.epfEmployee ?? 0), socsoEmployee: Number(body.socsoEmployee ?? 0),
        eisEmployee: Number(body.eisEmployee ?? 0), pcb: Number(body.pcb ?? 0),
        epfEmployer: Number(body.epfEmployer ?? 0), socsoEmployer: Number(body.socsoEmployer ?? 0),
        eisEmployer: Number(body.eisEmployer ?? 0),
      };
      if (!entryId || !Number.isFinite(allowance) || allowance < 0 || !Number.isFinite(deduction) || deduction < 0 || !Number.isFinite(zakat) || zakat < 0 || Object.values(statutory).some((v) => !Number.isFinite(v) || v < 0)) return NextResponse.json({ error: "All payroll amounts must be valid non-negative amounts" }, { status: 400 });
      const entry = await prisma.payrollEntry.findUnique({ where: { id: entryId }, include: { payrollRun: true } });
      if (!entry) return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 });
      if (entry.payrollRun.status !== "DRAFT") return NextResponse.json({ error: "Only draft payroll entries can be adjusted" }, { status: 409 });
      if (entry.workOrderId) return NextResponse.json({ error: "Adjust statutory amounts on the employee summary row, not an individual Work Order row" }, { status: 400 });
      if (entry.statutoryStatus === "RULE_CHANGED") return NextResponse.json({ error: "Commission settings changed. Regenerate this month's draft before making payroll adjustments." }, { status: 409 });
      const updated = await prisma.$transaction(async (tx) => {
        const currentRun = await tx.payrollRun.findUnique({ where: { id: entry.payrollRunId } });
        if (!currentRun || currentRun.status !== "DRAFT") throw new Error("Payroll is no longer a draft; reload before adjusting");
        const employeeDeductions = statutory.epfEmployee + statutory.socsoEmployee + statutory.eisEmployee + statutory.pcb + zakat;
        const employeeRows = await tx.payrollEntry.findMany({ where: { payrollRunId: entry.payrollRunId, userId: entry.userId }, select: { commissionAmount: true } });
        const totalEmployeeGross = money(employeeRows.reduce((sum, row) => sum + row.commissionAmount, 0) + entry.basicSalary + allowance);
        if (deduction + employeeDeductions > totalEmployeeGross + 0.001) throw new Error("Total employee deductions cannot exceed the employee's total gross pay. Check the entered statutory amounts.");
        const netPay = money(entry.basicSalary + allowance - deduction - employeeDeductions);
        const row = await tx.payrollEntry.update({ where: { id: entryId }, data: { allowance: money(allowance), deduction: money(deduction), zakat: money(zakat), epfEmployee: money(statutory.epfEmployee), socsoEmployee: money(statutory.socsoEmployee), eisEmployee: money(statutory.eisEmployee), pcb: money(statutory.pcb), epfEmployer: money(statutory.epfEmployer), socsoEmployer: money(statutory.socsoEmployer), eisEmployer: money(statutory.eisEmployer), statutoryStatus: "MANUAL_OVERRIDE", statutoryReviewed: false, statutoryDetails: JSON.stringify({ source: "OWNER_MANUAL_OVERRIDE", updatedAt: new Date().toISOString(), ...statutory }), totalAmount: netPay } });
        const rows = await tx.payrollEntry.findMany({ where: { payrollRunId: entry.payrollRunId }, select: { totalAmount: true } });
        await tx.payrollRun.update({ where: { id: entry.payrollRunId }, data: { totalAmount: money(rows.reduce((sum, x) => sum + x.totalAmount, 0)) } });
        return row;
      });
      await writeAuditLog({ actor, request, action: "PAYROLL_ENTRY_ADJUSTED", entityType: "PayrollEntry", entityId: entryId, summary: `Payroll adjustment saved for ${entry.employeeName}`, details: { allowance, deduction, zakat, ...statutory } });
      return NextResponse.json(updated);
    }

    if (body.action === "recalculate-statutory") {
      const entryId = String(body.entryId || "");
      const entry = await prisma.payrollEntry.findUnique({ where: { id: entryId }, include: { payrollRun: true } });
      if (!entry) return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 });
      if (entry.workOrderId) return NextResponse.json({ error: "Recalculate statutory amounts on the employee summary row" }, { status: 400 });
      if (entry.payrollRun.status !== "DRAFT") return NextResponse.json({ error: "Only draft payroll can be recalculated" }, { status: 409 });
      if (entry.statutoryStatus === "RULE_CHANGED") return NextResponse.json({ error: "Commission settings changed. Regenerate this month's draft before recalculating statutory amounts." }, { status: 409 });
      const rule = await prisma.payrollCommissionRule.findUnique({ where: { userId: entry.userId } });
      if (!rule?.statutoryProfileComplete) return NextResponse.json({ error: "Save the employee statutory profile before recalculating" }, { status: 400 });
      const [employeeRows, priorEntries] = await Promise.all([
        prisma.payrollEntry.findMany({ where: { payrollRunId: entry.payrollRunId, userId: entry.userId }, select: { commissionAmount: true } }),
        prisma.payrollEntry.findMany({ where: { userId: entry.userId, payrollRun: { is: { status: "PAID", periodKey: { gte: `${entry.payrollRun.periodKey.slice(0, 4)}-01`, lt: entry.payrollRun.periodKey } } } }, select: { commissionAmount: true, basicSalary: true, allowance: true, epfEmployee: true, socsoEmployee: true, pcb: true, zakat: true, taxRelief: true } }),
      ]);
      const priorTotals = priorEntries.reduce((sum, row) => ({
        gross: sum.gross + row.commissionAmount + row.basicSalary + row.allowance,
        epf: sum.epf + row.epfEmployee, socso: sum.socso + row.socsoEmployee, pcb: sum.pcb + row.pcb, zakat: sum.zakat + row.zakat, taxRelief: sum.taxRelief + row.taxRelief,
      }), { gross: 0, epf: 0, socso: 0, pcb: 0, zakat: 0, taxRelief: 0 });
      const grossWages = money(employeeRows.reduce((sum, row) => sum + row.commissionAmount, 0) + entry.basicSalary + entry.allowance);
      const statutory = calculateMalaysiaStatutory({
        grossWages,
        periodKey: entry.payrollRun.periodKey,
        profile: {
          statutoryProfileComplete: rule.statutoryProfileComplete,
          epfCategory: rule.epfCategory as PayrollStatutoryProfile["epfCategory"], socsoCategory: rule.socsoCategory as PayrollStatutoryProfile["socsoCategory"], socsoSkbbk: rule.socsoSkbbk as PayrollStatutoryProfile["socsoSkbbk"],
          eisEligible: rule.eisEligible, taxResidency: rule.taxResidency as PayrollStatutoryProfile["taxResidency"], taxCategory: rule.taxCategory as PayrollStatutoryProfile["taxCategory"],
          qualifyingChildren: rule.qualifyingChildren, disabledSelf: rule.disabledSelf, disabledSpouse: rule.disabledSpouse,
          priorGrossYtd: rule.priorGrossYtd + priorTotals.gross, priorEpfYtd: rule.priorEpfYtd + priorTotals.epf, priorPcbYtd: rule.priorPcbYtd + priorTotals.pcb,
          priorZakatYtd: rule.priorZakatYtd + priorTotals.zakat, priorSocsoYtd: rule.priorSocsoYtd + priorTotals.socso, taxReliefYtd: rule.taxReliefYtd + priorTotals.taxRelief,
          taxReliefMonthly: rule.taxReliefMonthly, zakatMonthly: rule.zakatMonthly ?? 0,
        },
      });
      if (!statutory) return NextResponse.json({ error: "Unable to calculate statutory amounts" }, { status: 400 });
      const employeeDeductions = statutory.epfEmployee + statutory.socsoEmployee + statutory.eisEmployee + statutory.pcb + rule.zakatMonthly;
      if (entry.deduction + employeeDeductions > grossWages + 0.001) return NextResponse.json({ error: "Statutory deductions exceed this employee's gross pay. Check the profile and wage basis." }, { status: 400 });
      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payrollEntry.update({ where: { id: entryId }, data: {
          epfEmployee: statutory.epfEmployee, epfEmployer: statutory.epfEmployer,
          socsoEmployee: statutory.socsoEmployee, socsoEmployer: statutory.socsoEmployer,
          eisEmployee: statutory.eisEmployee, eisEmployer: statutory.eisEmployer, pcb: statutory.pcb,
          zakat: money(rule.zakatMonthly), taxRelief: money(rule.taxReliefMonthly),
          statutoryStatus: "CALCULATED_REVIEW_REQUIRED", statutoryReviewed: false,
          statutoryDetails: JSON.stringify(statutory),
          totalAmount: money(entry.basicSalary + entry.allowance - entry.deduction - employeeDeductions),
        } });
        const totals = await tx.payrollEntry.findMany({ where: { payrollRunId: entry.payrollRunId }, select: { totalAmount: true } });
        await tx.payrollRun.update({ where: { id: entry.payrollRunId }, data: { totalAmount: money(totals.reduce((sum, value) => sum + value.totalAmount, 0)) } });
        return row;
      });
      await writeAuditLog({ actor, request, action: "PAYROLL_STATUTORY_RECALCULATED", entityType: "PayrollEntry", entityId: entryId, summary: `Statutory amounts recalculated for ${entry.employeeName}`, details: { grossWages, calculationVersion: statutory.calculationVersion } });
      return NextResponse.json(updated);
    }

    if (body.action === "review-statutory") {
      const entryId = String(body.entryId || "");
      const entry = await prisma.payrollEntry.findUnique({ where: { id: entryId }, include: { payrollRun: true } });
      if (!entry) return NextResponse.json({ error: "Payroll entry not found" }, { status: 404 });
      if (entry.workOrderId) return NextResponse.json({ error: "Review statutory amounts on the employee summary row" }, { status: 400 });
      if (entry.payrollRun.status !== "DRAFT") return NextResponse.json({ error: "Only draft payroll entries can be reviewed" }, { status: 409 });
      if (entry.statutoryStatus === "RULE_CHANGED") return NextResponse.json({ error: "Commission settings changed. Regenerate this month's draft before reviewing it." }, { status: 409 });
      if (["PROFILE_REQUIRED", "PROFILE_CHANGED"].includes(entry.statutoryStatus)) return NextResponse.json({ error: "Complete or recalculate the employee statutory profile before confirming review" }, { status: 409 });
      const updated = await prisma.$transaction(async (tx) => {
        const currentRun = await tx.payrollRun.findUnique({ where: { id: entry.payrollRunId }, select: { status: true } });
        if (!currentRun || currentRun.status !== "DRAFT") return { count: 0 };
        return tx.payrollEntry.updateMany({
          where: { id: entryId, payrollRunId: entry.payrollRunId, statutoryStatus: entry.statutoryStatus, statutoryReviewed: false },
          data: { statutoryReviewed: true },
        });
      });
      if (updated.count !== 1) return NextResponse.json({ error: "Payroll changed while you were reviewing it. Refresh the page and check the amounts again." }, { status: 409 });
      await writeAuditLog({ actor, request, action: "PAYROLL_STATUTORY_REVIEWED", entityType: "PayrollEntry", entityId: entryId, summary: `Statutory payroll amounts reviewed for ${entry.employeeName}`, details: { statutoryStatus: entry.statutoryStatus } });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "approve" || body.action === "mark-paid") {
      const id = String(body.id || "");
      const run = await prisma.payrollRun.findUnique({ where: { id } });
      if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
      if (body.action === "approve") {
        const approval = await prisma.$transaction(async (tx) => {
          const current = await tx.payrollRun.findUnique({ where: { id } });
          if (!current) return { error: "Payroll run not found", status: 404 as const };
          if (current.status !== "DRAFT") return { error: "Only a draft payroll can be approved", status: 409 as const };
          const [summaryRows, allEntryCount] = await Promise.all([
            tx.payrollEntry.findMany({ where: { payrollRunId: id, workOrderId: null }, select: { employeeName: true, statutoryStatus: true, statutoryReviewed: true } }),
            tx.payrollEntry.count({ where: { payrollRunId: id } }),
          ]);
          if (allEntryCount > 0 && summaryRows.length === 0) return { error: "This draft was created by an older Payroll version. Regenerate the draft to create employee summary rows before approval.", status: 409 as const };
          const staleRules = summaryRows.filter((row) => row.statutoryStatus === "RULE_CHANGED");
          if (staleRules.length) return { error: `Commission settings changed after this draft was generated. Regenerate this month's draft before approval: ${staleRules.map((row) => row.employeeName).join(", ")}`, status: 409 as const };
          const incomplete = summaryRows.filter((row) => ["PROFILE_REQUIRED", "PROFILE_CHANGED"].includes(row.statutoryStatus) || !row.statutoryReviewed);
          if (incomplete.length) return { error: `Review statutory payroll amounts and complete employee profiles before approval: ${incomplete.map((row) => row.employeeName).join(", ")}`, status: 409 as const };
          const claimed = await tx.payrollRun.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED", approvedAt: new Date() } });
          if (claimed.count !== 1) return { error: "Payroll status changed; refresh and try again", status: 409 as const };
          const updated = await tx.payrollRun.findUnique({ where: { id } });
          return { updated, previous: current };
        });
        if ("error" in approval) return NextResponse.json({ error: approval.error }, { status: approval.status });
        await writeAuditLog({ actor, request, action: "PAYROLL_APPROVED", entityType: "PayrollRun", entityId: id, summary: `Payroll ${approval.previous.periodKey} approved`, details: { totalAmount: approval.previous.totalAmount } });
        return NextResponse.json(approval.updated);
      }
      if (run.status !== "APPROVED") return NextResponse.json({ error: "Approve payroll before marking it paid" }, { status: 409 });
      const claimed = await prisma.payrollRun.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PAID", paidAt: new Date() } });
      if (claimed.count !== 1) return NextResponse.json({ error: "Payroll status changed; refresh and try again" }, { status: 409 });
      const updated = await prisma.payrollRun.findUnique({ where: { id } });
      await writeAuditLog({ actor, request, action: "PAYROLL_MARKED_PAID", entityType: "PayrollRun", entityId: id, summary: `Payroll ${run.periodKey} marked as paid`, details: { totalAmount: run.totalAmount } });
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: "Unsupported payroll action" }, { status: 400 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Unable to process payroll request" }, { status: 500 });
  }
}
