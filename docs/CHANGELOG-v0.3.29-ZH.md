# Car Workshop POS v0.3.29 — Core Foundation

发布日期：2026-11-13

## 本版完成

- 统一 `package.json` 与 `package-lock.json` 版本为 `0.3.29`。
- 新增 MyInvois Buyer 核心验证器，Individual Buyer 不再接受 General Public 回退资料。
- UBL Builder 增加第二道防线；只有 Consolidated 或明确标记的 Consolidated Credit Note 才能使用 General Public。
- Individual e-Invoice API 在提交前检查买家资料，并把失败字段写入 Audit Log（不记录买家证件/TIN 原文）。
- 新增 `EInvoiceSubmissionLog`，记录 Invoice、Consolidated、Credit Note 的提交状态、UUID、Submission UID、环境和错误摘要。
- MyInvois Client Secret 改为 AES-256-GCM 加密保存；旧版明文 Secret 在首次读取配置时自动迁移。
- 新增 `SystemMigration` 版本记录表。
- 所有数据库升级继续采用只新增表/字段的策略，不删除旧数据。

## 兼容性及安全说明

- 现有 SQLite 数据库会在启动时先做 `VACUUM INTO` 备份，再执行新增表升级。
- `AUTH_SECRET` 或 `MYINVOIS_ENCRYPTION_KEY` 必须设置且长期保持不变；更换密钥会导致已加密的 MyInvois Secret 无法解密。
- `MYINVOIS_ENCRYPTION_KEY` 建议作为独立且受保护的安装级密钥。若使用 `AUTH_SECRET` 派生密钥，必须保留原 `AUTH_SECRET`。
- 开发环境也必须显式配置密钥，不使用固定开发密钥；旧明文 Secret 只在成功读取时迁移；建议升级后检查数据库备份策略。
- 生产 MyInvois 提交仍保持 fail-closed：当前版本没有完成并验证 XAdES 证书签名，不会擅自开放生产提交。

## 测试

新增 Node 测试覆盖（当前总计 40 项通过）：
- 完整 Individual Buyer
- General Public Individual 拦截
- Consolidated General Public 放行
- State Code 17 拦截
- NRIC 格式
- Postcode 格式
- AES-256-GCM 加解密及旧明文兼容

完整 build、Prisma Client 生成、TypeScript 检查和 MyInvois Sandbox 实际提交需要在安装依赖的 Windows 构建环境执行。
