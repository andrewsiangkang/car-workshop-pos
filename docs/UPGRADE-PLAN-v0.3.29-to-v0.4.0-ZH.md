# Car Workshop POS 完整升级计划 v0.3.29 → v0.4.0

产品定位：Commercial Global Workshop Management System  
升级方式：Preserve Existing Features / Additive Migration  
部署原则：Local Offline First；单一 Windows 主机运行 SQLite 服务，局域网客户端访问。

## 当前交付状态\n\n- v0.3.29 Core Foundation：本次源码包已实现主要基础任务。\n- v0.3.30 至 v0.4.0：仍属于后续开发阶段，不包含在本次代码交付中。\n\n## 版本路线

| 版本 | 范围 | 主要交付 |
|---|---|---|
| 0.3.29 | Core Foundation | LHDN Buyer Validator、Secret Encryption、Submission Log、Migration History |
| 0.3.30 | Financial Engine | Sen 整数金额、SST、退款、对账、利润 |
| 0.3.31 | Backup & Recovery | SQLite 一致性快照、Uploads、Manifest、校验、恢复演练 |
| 0.3.32 | Inventory Pro | PO、收货、盘点、调整、退货、库存成本 |
| 0.3.33 | CRM & Automation | Customer 360、车辆服务历史、提醒、通知适配器 |
| 0.3.34 | Workshop Management | 入厂检查、技师任务、照片、顾客审批、质检、保修 |
| 0.4.0 | Commercial Edition | Branch/Tenant、区域配置、授权、离线部署验收 |

## 功能保留基线

Dashboard、Customer、Vehicle、Work Order、Quotation、Invoice、Receipt、Payment、Split Payment、Cash Shift、Cash Rounding、SST、MyInvois、Consolidated e-Invoice、Credit Note、Refund、Inventory、Stock Movement、Supplier、Supplier Invoice、Payment Voucher、Service Reminder、QR Buyer Form、OCR、Document Templates、CSV Export、User/Role、Audit Log、Backup/Restore、Electron Desktop、LAN Access。

## 数据库原则

1. 仅新增表、字段、索引；不得删除旧模型或直接重建用户数据库。
2. 每次升级前创建 SQLite 一致性快照。
3. 新字段必须同步修改 `schema.prisma` 与 `schema-upgrade.ts`。
4. 财务金额先双字段过渡：旧 Float 保留用于兼容，新计算使用整数 Sen 或 Decimal；完成差异核对后再决定是否弃用旧字段。
5. 新增 Branch/Tenant 前先制定数据隔离方案，不在单店阶段提前强制所有查询改写。

## 测试发布门槛

- Unit：金额、税务、Buyer、库存规则
- Database：从每个受支持版本迁移、备份和恢复
- API：所有读写端点的身份及角色验证
- Integration：订单、库存、付款、退款、发票联动
- MyInvois：Pre-Production UBL 校验、提交、状态轮询、重复提交保护
- Security：密钥、Session、CSRF、上传、路径遍历、LAN HTTPS
- E2E：Windows Desktop、浏览器、同 Wi-Fi 手机
- Regression：功能保留基线全部通过

## 商业版验收

不得存在未解决的 Critical/High 安全问题；数据库升级和恢复演练通过；财务对账一致；MyInvois 沙盒流程通过；核心业务 E2E 通过；Windows 安装/升级/卸载保留数据；多分店隔离经过测试。
