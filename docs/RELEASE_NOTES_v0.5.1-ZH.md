# v0.5.1 — Payroll & Commission

## 新增
- 老板专属 Payroll & Commission 页面，目前支持 TECHNICIAN 员工；佣金按 Work Order 的 Assigned To 技师归属。
- 老板逐个员工设定佣金基数：Labour、Spare Parts、Gross Profit、Work Order Total。
- 每位技师独立佣金率、月基本薪资和启用状态；没有配置并启用的员工不会进入薪资计算。
- 按马来西亚日历月份生成 Payroll Draft；读取该月已完成且分配给员工的 Work Order。
- 佣金只按实际收款比例计算，退款/credit note 会降低净发票金额。
- 月基本薪资、Allowance、Deduction；草稿可调整，调整有审计记录。
- Payroll 状态：DRAFT → APPROVED → PAID；审批或付款后不可重新生成或修改。
- 每张 Work Order 最多只能计入一次佣金，已在其他 Payroll Run 计入的工单会被排除。
- 旧本地数据库通过 schema-upgrade 自动新增 Payroll 表，不删除既有 POS 数据。

## 计算说明
- Labour / Parts：分别汇总 WorkOrderItem 对应类别的行总额。
- Gross Profit：行总额减去对应数量的成本价。
- Work Order Total：Work Order 净额（totalAmount - creditedAmount）。
- Commission Basis = 佣金基数 × 已收款比例；Commission = Commission Basis × 技师佣金率。
- Basic Salary 是老板为技师设定的月薪，在每月 Payroll Draft 中计入一次。

## 尚未包含 / 需要确认
- 此版本不自动计算 EPF、SOCSO、EIS、PCB、法定加班、假期薪资或其他马来西亚法定薪酬项目。
- 未包含银行批量转账、电子签名、自动 PDF payslip、部分月份入职/离职基本薪资按天折算。
- 佣金只读取 Work Order 的 Assigned To 员工；一张工单的多名技师分佣比例尚未实现。
- 本地源码环境缺少完整依赖，Prisma generate、TypeScript 检查、Next.js production build 和 Windows 安装包测试仍需在依赖完整环境验证。
