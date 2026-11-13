# Car Workshop POS v0.3.29 源码审计报告

审计基线：用户上传的 `car-workshop-pos-v0.3.28-lhdn-buyer-validation-fix.zip`  
审计目标：保持现有业务功能，实施 v0.3.29 Core Foundation。

## 1. 基线架构

- Next.js 15.3.9 / React 19
- TypeScript
- Prisma 6.5 / SQLite
- Electron 33
- MyInvois UBL 2.1
- Tesseract.js OCR
- Node.js Test Runner

## 2. 审计发现与处理

| 严重度 | 发现 | 本版处理 |
|---|---|---|
| 高 | UBL 通用 Buyer Builder 对缺失资料仍有 General Public / NA / State 17 默认值 | Builder 默认拒绝不完整买家；Consolidated 显式允许 |
| 高 | 仅在 API 层检查部分 Buyer 字段，底层 Builder 缺少第二道验证 | 新增共用 Buyer Validator，并在 API + Builder 双重检查 |
| 高 | MyInvois Client Secret 以明文存储 | 新增 AES-256-GCM 加密及旧明文首次读取迁移 |
| 中 | 缺少结构化的 MyInvois 提交尝试历史 | 新增 EInvoiceSubmissionLog |
| 中 | 数据库升级没有独立版本记录 | 新增 SystemMigration |
| 中 | package 与 lockfile 版本不一致 | 两者统一至 0.3.29 |

## 3. API 入口静态检查\n\n本次扫描到 39 个 API Route 文件：34 个业务路由包含 `requireAuth` 或 `requireOwner`；5 个公开例外为登录、登出、首次设置、版本查询及使用不可猜测 Token 的顾客 e-Invoice QR 页面。此项为源码静态检查，不替代运行时渗透测试。\n\n## 4. 仍需在真实构建环境确认

- `npm ci`
- `npx prisma generate`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- Electron Windows 打包
- 从旧 SQLite 数据库升级与还原演练
- MyInvois Pre-Production 实际申报

## 5. 未在本版宣称完成

以下属于后续版本，不应误认为已实现：
- 全面 Float 到整数 Sen / Decimal 的历史数据迁移
- Electron/API 统一备份引擎与 SHA-256 Manifest
- 完整采购订单、盘点、FIFO 库存成本
- Customer 360、WhatsApp Business 集成
- Vehicle Inspection、技师任务、电子签名
- 多分店、租户隔离及商业授权服务

## 6. 风险控制

- 不删除现有 Prisma 模型或旧字段。
- 新增表采用 additive migration。
- 加密密钥不得随版本变更；密钥遗失时无法解密已加密凭证。
- 生产 e-Invoice 仍保持签名未就绪时禁止提交。
