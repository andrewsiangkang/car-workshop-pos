# Car Workshop POS v0.3.8 审计及改善报告

**基准版本：** 用户提供 v0.3.5，延续 v0.3.6 / v0.3.7   
**本次版本：** v0.3.8  
**日期：** 2026-11-12

## 本次已经完成

1. **登录防暴力破解改为 SQLite 持久化**：程序重启后仍保留失败次数及短暂锁定；数据库只保存用户名的 SHA-256 摘要，不保存明文用户名作为限流 key。旧的内存计数器已移除。
2. **扩大 Audit Trail 记录范围**：加入退款/贷项通知单、供应商发票录入及付款/作废、付款凭证建立/作废、员工账号新增/修改/删除、客户建立、店铺设置修改、MyInvois 提交及状态查询记录。
3. **审计资料避免记录敏感内容**：不会记录密码、密码 hash、MyInvois Client Secret；设置凭证变更只记录是否变更，不记录凭证值。
4. **金额计算基础强化**：加入整数 sen 转换、金额相加、四舍五入及乘数量函数；共享 `money()` 采用新的 sen 舍入函数。
5. **MyInvois 正式环境安全锁**：由于目前尚未实现 XAdES 数字签名，个人发票、合并发票及 Credit Note 的正式环境提交都会返回 501 并停止提交；Sandbox 测试路径保留。
6. **版本升级**：v0.3.8；新增 `npm test`。

## 测试结果

- Node 内置测试：5 项通过。
- SQLite LoginThrottle 建表、索引、连续 5 次失败 upsert 测试：通过。
- TypeScript 126 个文件语法转译检查：通过。
- Electron JS 语法检查：通过。
- `npm ci`：本环境无法解析 registry.npmjs.org（EAI_AGAIN），依赖没有装好。另检查发现现有 package-lock.json 不完整：缺少 package.json 声明的部分依赖，并且 Next / eslint-config-next 版本锁在 15.3.2，而 package.json 指定 15.3.9。必须在可联网电脑执行 `npm install` 重新生成 lockfile，再执行 `npm ci`。
- 因此 Prisma validate / generate、完整 TypeScript 类型检查、ESLint、Next.js production build、Electron 安装包、真实门店数据库升级和恢复演练尚未完成。

## 仍未完成的关键工作

### 1. 所有金额字段迁移到整数 sen

**尚未完成。** 当前 Prisma 数据库仍有 `Float` / SQLite `REAL` 金额字段。v0.3.8 只加强计算函数，未改写历史数据库结构。必须逐个盘点工单、工单项目、付款、退款、现金班次、供应商发票、付款凭证、费用、贷项通知单及合并发票，区分金额、数量、税率及里程等非金额字段，再制作迁移脚本和对账报告。未通过对账前不能迁移正式数据库。

### 2. MyInvois XAdES 签名

**尚未完成，生产提交已锁住。** 官方 SDK 要求提交已签名文件，并规定使用马来西亚认可 CA 颁发的 X.509 证书及 XAdES 签名。必须由店铺准备组织数字证书，并先确定私钥保管方案。不要把 `.pfx` 私钥或密码贴到聊天或放进源码仓库。

官方文件：
- https://sdk.myinvois.hasil.gov.my/signature/
- https://sdk.myinvois.hasil.gov.my/einvoicingapi/02-submit-documents/

### 3. 正式上线前必须完成

- 在真实 v0.3.5 数据库副本上测试升级至 v0.3.8，并检查旧资料数量及金额。
- 先在可联网电脑执行 `npm install` 重建 package-lock，再执行 `npm ci`；然后执行 `npm test`、`npx prisma validate`、`npx prisma generate`、`npm run lint`、`npm run typecheck`、`npm run build`。
- 备份数据库和 uploads，并在另一台隔离电脑完整恢复。
- 测试登录锁定、员工权限、库存出入、供应商付款/作废、客户退款、现金柜台结算、审计记录及 MyInvois Sandbox。
- 完成整数 sen 数据迁移及对账。
- 完成证书签名实现并通过 Sandbox 签名验证，之后才考虑开放生产环境。

## 结论

v0.3.8 是安全强化及受控测试版本，不是最终生产验收版本。已落地登录限流持久化、审计范围扩展、金额 sen 计算基础及 MyInvois 生产环境保护。整数 sen 数据库迁移、XAdES 签名、完整集成测试和备份恢复演练仍需完成。
