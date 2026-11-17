import { Header } from "@/components/layout/Header";
import { prisma } from "@/lib/prisma";
import { requirePageOwner } from "@/lib/auth";
import { PayrollManager } from "./PayrollManager";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  await requirePageOwner();
  const [employees, runs] = await Promise.all([
    prisma.user.findMany({ where: { role: "TECHNICIAN", disabledAt: null }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, email: true, role: true, payrollRule: true } }),
    prisma.payrollRun.findMany({ orderBy: { periodKey: "desc" }, take: 18, include: { entries: { orderBy: [{ employeeName: "asc" }, { createdAt: "asc" }], include: { workOrder: { select: { orderNumber: true } } } } } }),
  ]);
  return <div className="max-w-6xl space-y-5"><Header title="Payroll & Commission" description="Owner-controlled employee commission rules, monthly payroll drafts, approval and payment records." /><PayrollManager employees={employees.map((e) => ({ id: e.id, name: e.name, email: e.email, role: e.role, rule: e.payrollRule ? {
      basis: e.payrollRule.basis, commissionRate: e.payrollRule.commissionRate, basicSalary: e.payrollRule.basicSalary, isActive: e.payrollRule.isActive,
      statutoryProfileComplete: e.payrollRule.statutoryProfileComplete, epfCategory: e.payrollRule.epfCategory, socsoCategory: e.payrollRule.socsoCategory, socsoSkbbk: e.payrollRule.socsoSkbbk, eisEligible: e.payrollRule.eisEligible,
      taxResidency: e.payrollRule.taxResidency, taxCategory: e.payrollRule.taxCategory, qualifyingChildren: e.payrollRule.qualifyingChildren, disabledSelf: e.payrollRule.disabledSelf, disabledSpouse: e.payrollRule.disabledSpouse,
      priorGrossYtd: e.payrollRule.priorGrossYtd, priorEpfYtd: e.payrollRule.priorEpfYtd, priorPcbYtd: e.payrollRule.priorPcbYtd, priorZakatYtd: e.payrollRule.priorZakatYtd, priorSocsoYtd: e.payrollRule.priorSocsoYtd,
      taxReliefYtd: e.payrollRule.taxReliefYtd, taxReliefMonthly: e.payrollRule.taxReliefMonthly, zakatMonthly: e.payrollRule.zakatMonthly,
    } : null }))} runs={runs.map((r) => ({ id: r.id, periodKey: r.periodKey, status: r.status, totalAmount: r.totalAmount, approvedAt: r.approvedAt?.toISOString() || null, paidAt: r.paidAt?.toISOString() || null, entries: r.entries.map((e) => ({ id: e.id, userId: e.userId, employeeName: e.employeeName, basis: e.basis, basisAmount: e.basisAmount, commissionRate: e.commissionRate, commissionAmount: e.commissionAmount, basicSalary: e.basicSalary, allowance: e.allowance, deduction: e.deduction, zakat: e.zakat, epfEmployee: e.epfEmployee, socsoEmployee: e.socsoEmployee, eisEmployee: e.eisEmployee, pcb: e.pcb, epfEmployer: e.epfEmployer, socsoEmployer: e.socsoEmployer, eisEmployer: e.eisEmployer, totalAmount: e.totalAmount, workOrderNumber: e.workOrder?.orderNumber || null, statutoryStatus: e.statutoryStatus, statutoryReviewed: e.statutoryReviewed })) }))} /></div>;
}
