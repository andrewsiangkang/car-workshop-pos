"use client";

type PayslipEntry = {
  id: string;
  userId: string;
  employeeName: string;
  basis: string;
  basisAmount: number;
  commissionRate: number;
  commissionAmount: number;
  basicSalary: number;
  allowance: number;
  deduction: number;
  zakat: number;
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  pcb: number;
  epfEmployer: number;
  socsoEmployer: number;
  eisEmployer: number;
  totalAmount: number;
  workOrderNumber: string | null;
  statutoryStatus: string;
  statutoryReviewed: boolean;
};
type PayslipRun = { periodKey: string; status: string; paidAt: string | null; approvedAt: string | null; entries: PayslipEntry[] };

const money = (value: number) => `RM ${Number(value || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));
const basisLabel: Record<string, string> = { LABOR: "Labour / Service", PARTS: "Spare Parts", GROSS_PROFIT: "Gross Profit", TOTAL: "Work Order Total" };

function buildPayslipDocument(run: PayslipRun, entries: PayslipEntry[]) {
  const first = entries[0];
  const totalCommission = entries.reduce((sum, row) => sum + row.commissionAmount, 0);
  const basic = entries.reduce((sum, row) => sum + row.basicSalary, 0);
  const allowance = entries.reduce((sum, row) => sum + row.allowance, 0);
  const deduction = entries.reduce((sum, row) => sum + row.deduction, 0);
  const zakat = entries.reduce((sum, row) => sum + row.zakat, 0);
  const epfEmployee = entries.reduce((sum, row) => sum + row.epfEmployee, 0);
  const socsoEmployee = entries.reduce((sum, row) => sum + row.socsoEmployee, 0);
  const eisEmployee = entries.reduce((sum, row) => sum + row.eisEmployee, 0);
  const pcb = entries.reduce((sum, row) => sum + row.pcb, 0);
  const epfEmployer = entries.reduce((sum, row) => sum + row.epfEmployer, 0);
  const socsoEmployer = entries.reduce((sum, row) => sum + row.socsoEmployer, 0);
  const eisEmployer = entries.reduce((sum, row) => sum + row.eisEmployer, 0);
  const gross = totalCommission + basic + allowance - deduction;
  const net = entries.reduce((sum, row) => sum + row.totalAmount, 0);
  const autoPreview = entries.some((row) => row.statutoryStatus === "CALCULATED_REVIEW_REQUIRED");
  const statutoryReviewed = entries.filter((row) => !row.workOrderNumber).every((row) => row.statutoryReviewed);
  const rows = entries.map((row) => `<tr><td>${esc(row.workOrderNumber || "Monthly salary / adjustment")}</td><td>${esc(basisLabel[row.basis] || row.basis)}</td><td class="num">${row.commissionRate.toFixed(2)}%</td><td class="num">${money(row.basisAmount)}</td><td class="num">${money(row.commissionAmount)}</td><td class="num">${money(row.basicSalary)}</td></tr>`).join("");
  const statusLabel = run.status === "PAID" ? "PAID" : "APPROVED";
  const dateLabel = run.paidAt ? new Date(run.paidAt).toLocaleDateString("en-MY") : run.approvedAt ? new Date(run.approvedAt).toLocaleDateString("en-MY") : "—";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip - ${esc(first.employeeName)} - ${esc(run.periodKey)}</title><style>
    @page{size:A5 landscape;margin:7mm}*{box-sizing:border-box}body{font:9px Arial,sans-serif;color:#172033;margin:0}.toolbar{display:flex;justify-content:flex-end;gap:8px;margin:0 0 8px}.toolbar button{border:0;border-radius:5px;padding:7px 11px;background:#172033;color:#fff;font-weight:700;cursor:pointer}.sheet{width:100%;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #172033;padding-bottom:6px}.brand{font-size:14px;font-weight:800}.muted{color:#64748b}.tag{border:1px solid #94a3b8;border-radius:4px;padding:3px 6px;font-weight:700;font-size:8px}.title{font-size:16px;font-weight:800;margin:8px 0}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:5px 12px;background:#f8fafc;padding:7px;border:1px solid #e2e8f0}.meta b{display:block;font-size:7px;color:#64748b;text-transform:uppercase;margin-bottom:2px}.section{font-weight:700;margin:8px 0 4px}table{width:100%;border-collapse:collapse;font-size:8px}th{background:#f1f5f9;text-align:left;color:#475569}th,td{padding:4px 5px;border-bottom:1px solid #e2e8f0}.num{text-align:right;white-space:nowrap}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:7px}.box{border:1px solid #e2e8f0;padding:6px}.line{display:flex;justify-content:space-between;padding:2px 0}.net{font-size:13px;font-weight:800;border-top:1.5px solid #172033;margin-top:4px;padding-top:5px}.note{margin-top:8px;padding-top:5px;border-top:1px solid #cbd5e1;color:#64748b;font-size:7px;line-height:1.35}.signature{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:15px}.signature div{border-top:1px solid #64748b;padding-top:4px;color:#64748b;font-size:7px}@media print{.toolbar{display:none}.sheet{max-width:none}}
    </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button></div><main class="sheet"><header class="top"><div><div class="brand">CAR WORKSHOP POS</div><div class="muted">Employee payroll statement</div></div><div class="tag">${statusLabel}</div></header><div class="title">EMPLOYEE PAYSLIP</div><section class="meta"><div><b>Employee name</b>${esc(first.employeeName)}</div><div><b>Payroll period</b>${esc(run.periodKey)}</div><div><b>Statement type</b>Employee copy</div><div><b>Approval / payment date</b>${esc(dateLabel)}</div><div><b>Payroll status</b>${statusLabel}</div><div><b>Currency</b>MYR (RM)</div></section><div class="section">Commission & earnings details</div><table><thead><tr><th>Work Order / Item</th><th>Commission basis</th><th class="num">Rate</th><th class="num">Basis</th><th class="num">Commission</th><th class="num">Basic</th></tr></thead><tbody>${rows}</tbody></table><section class="summary"><div class="box"><div class="section">Earnings</div><div class="line"><span>Commission</span><b>${money(totalCommission)}</b></div><div class="line"><span>Basic salary</span><b>${money(basic)}</b></div><div class="line"><span>Allowance</span><b>${money(allowance)}</b></div><div class="line"><span>Deduction</span><b>-${money(deduction)}</b></div><div class="line"><span>Zakat</span><b>-${money(zakat)}</b></div><div class="line"><span>Subtotal before statutory deductions</span><b>${money(gross)}</b></div><div class="net line"><span>NET PAY</span><span>${money(net)}</span></div></div><div class="box"><div class="section">Employee statutory deductions</div><div class="line"><span>EPF</span><b>${money(epfEmployee)}</b></div><div class="line"><span>SOCSO</span><b>${money(socsoEmployee)}</b></div><div class="line"><span>EIS</span><b>${money(eisEmployee)}</b></div><div class="line"><span>PCB / MTD</span><b>${money(pcb)}</b></div><div class="section">Employer contributions (not deducted from net pay)</div><div class="line"><span>EPF employer</span><b>${money(epfEmployer)}</b></div><div class="line"><span>SOCSO employer</span><b>${money(socsoEmployer)}</b></div><div class="line"><span>EIS employer</span><b>${money(eisEmployer)}</b></div></div></section><div class="signature"><div>Employee acknowledgement / date</div><div>Employer approval / date</div></div><footer class="note">${autoPreview ? "Statutory amounts were generated by the Malaysia 2026 payroll preview engine and must be checked against the current official KWSP, PERKESO and HASiL calculators. " : "Statutory amounts reflect employer-entered payroll values. "}${statutoryReviewed ? "Owner statutory review recorded. " : "Statutory review status is not confirmed. "}Employer contributions are shown separately and are not deducted from employee net pay. This statement is not proof of payment to KWSP, PERKESO or HASiL. Payroll status: ${statusLabel}.</footer></main></body></html>`;
}

function openPrintDocument(html: string) {
  const popup = window.open("", "_blank", "width=1100,height=800");
  if (!popup) { window.alert("Please allow pop-ups for this site, then try again."); return; }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.setTimeout(() => popup.print(), 350);
}

function openPayslip(run: PayslipRun, entries: PayslipEntry[]) {
  openPrintDocument(buildPayslipDocument(run, entries));
}

function openAllPayslips(run: PayslipRun, employees: PayslipEntry[][]) {
  const documents = employees.map((entries) => buildPayslipDocument(run, entries));
  const styles = documents[0]?.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  const pages = documents.map((doc) => doc.match(/<main class="sheet">([\s\S]*?)<\/main>/)?.[1] || "").join('<div class="page-break"></div>');
  openPrintDocument(`<!doctype html><html><head><meta charset="utf-8"><title>Payroll ${esc(run.periodKey)} - All Payslips</title><style>${styles}.toolbar{display:none}.page-break{page-break-after:always;break-after:page}</style></head><body><main class="sheet">${pages}</main></body></html>`);
}

export function PayslipActions({ run }: { run: PayslipRun }) {
  if (run.status === "DRAFT") return <p className="px-4 pb-3 text-xs text-amber-700">Approve payroll before issuing employee payslips.</p>;
  const grouped = new Map<string, PayslipEntry[]>();
  for (const entry of run.entries) grouped.set(entry.userId, [...(grouped.get(entry.userId) || []), entry]);
  const employees = [...grouped.values()].sort((a, b) => a[0].employeeName.localeCompare(b[0].employeeName));
  if (!employees.length) return null;
  return <div className="border-t border-slate-100 bg-slate-50 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm font-semibold">Employee Payslips</div><p className="text-xs text-slate-500">Print or choose “Save as PDF” in the print dialog. Each employee gets a separate A5 landscape page.</p></div><button onClick={() => openAllPayslips(run, employees)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Print All Employees</button></div>
    <div className="flex flex-wrap gap-2">{employees.map((rows) => <button key={rows[0].userId} onClick={() => openPayslip(run, rows)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">PDF / Print · {rows[0].employeeName}</button>)}</div>
  </div>;
}
