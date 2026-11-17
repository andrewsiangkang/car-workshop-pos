# Car Workshop POS v0.5.3 — Payroll & A5 Payslip

## 新增
- 员工工资单打印版调整为 A5 横向（A5 Landscape），支持单人打印 / Save as PDF，以及批量逐人分页打印。
- Payroll 草稿可记录员工 EPF、SOCSO、EIS、PCB 扣款。
- 独立记录雇主 EPF、SOCSO、EIS 供成本核算；不会从员工净薪扣除。
- 员工净薪按 Gross Earnings − Other Deduction − Employee EPF − Employee SOCSO − Employee EIS − PCB 计算。
- Statutory amounts 随 PayrollEntry 保存，审批后进入工资单快照。
- 旧数据库通过 schema-upgrade 增加字段，默认 0，不改动旧工资记录。

## 重要限制
- 本版本提供老板逐员工、逐月录入并核对官方金额的字段，不自动推算法定金额。EPF 必须按 KWSP Third Schedule 工资档计算；SOCSO/EIS 必须按 PERKESO 适用类别及工资档计算；PCB 需按 HASiL 2026 computerized MTD 规格及员工税务资料计算。
- 不会自动提交 KWSP / PERKESO / HASiL 缴款或报表。工资单金额需由老板或薪资人员核对后批准。
- 同一员工同一月份的 statutory amount 只应在该员工其中一条 Payroll Entry 输入一次，避免重复扣款。
