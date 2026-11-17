# Car Workshop POS v0.4.x 升级路线

## 唯一基线
- 用户提供的 `car-workshop-pos-main.zip`
- `package.json` 基线版本：0.3.34
- ZIP 内提交标识：`f981c40eec7db76a90a3288486aecc37cb1f0bad`
- 保留 Electron + Next.js + Prisma + SQLite；保持完全本地离线运行。

## 本轮 v0.4.0：Workshop Management Foundation
1. Workshop Board：报价待确认、待进场、维修中、已完成。
2. 工单优先级：LOW / NORMAL / HIGH / URGENT。
3. 预计完工时间。
4. TECHNICIAN 账号分配。
5. 工单状态时间线及操作人。
6. 首次进入 IN_PROGRESS 时记录 startedAt。

## 后续增量版本
- v0.4.1 Vehicle Inspection：检查模板、检查项目、检查结果、维修前后照片、PDF 检查报告、顾客确认。
- v0.4.2 Parts & Labour：零件预留、领用、退回、缺料提示、技师工时、人工成本及工单成本。
- v0.4.3 Appointment & Customer Experience：预约日历、冲突检测、到店登记、额外维修批准、店内局域网维修进度 QR。
- v0.4.4 Workshop Analytics：技师产能、平均维修时间、延迟率、返修率、工单毛利及服务表现。

## 数据库安全规则
- 只新增表、列、索引；不 DROP、不重命名、不重置旧表。
- 使用现有 `schema-upgrade.ts`；新字段必须同时写入 Prisma schema 与升级清单。
- 升级前先通过现有 `VACUUM INTO` 创建安全副本；升级 SQL 放在事务中。
- 不为历史工单补造不存在的历史事件。
- 数据库及本地照片/附件目录必须共同备份。

## 测试计划
1. 旧数据库升级：客户、车辆、工单、付款、库存、收银班次、电子发票资料数量与关键金额保持一致。
2. 幂等性：连续运行升级两次，第二次不产生结构变化或额外备份。
3. 新建工单：自动生成 QUOTED 初始时间线。
4. 状态转换：每次真实状态变化写入一条时间线；重复状态不产生重复事件。
5. 技师权限：只允许分配到启用的 TECHNICIAN 账户。
6. 排程：优先级、预计完工时间可保存、清除及正确显示逾期。
7. 业务回归：报价、发票、付款、退款、库存扣减、现金结算、SST、e-Invoice、备份还原均不回归。
8. Offline：断开互联网后仍可查看及操作本地工单。
9. 发布前：在生产数据库副本上完成升级演练和恢复演练。
