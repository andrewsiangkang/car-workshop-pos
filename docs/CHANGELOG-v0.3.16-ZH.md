# Car Workshop POS v0.3.16 — Customer Service Reminders

## 新增顾客保养提醒
- Sidebar 新增 Service Reminders（保养提醒）页面，老板和员工均可使用。
- 按车辆管理上次保养日期/里程、下次保养日期/里程及重复保养间隔。
- 自动分类：逾期、未来 30 天 / 500 km 内即将到期、已排期、尚未设置。
- 支持按车牌、车型、顾客姓名和电话号码搜索。
- 支持 WhatsApp 预填保养提醒信息；由员工打开 WhatsApp 后人工确认发送，不会自动发送。
- 标记保养完成时记录当前里程，并按设定的月份和公里间隔自动计算下一次提醒。
- 提醒资料保存在本地 SQLite 数据库。

## 数据库兼容
- Vehicle 新增 lastServiceDate、lastServiceMileage、nextServiceDate、nextServiceMileage、serviceIntervalKm、serviceIntervalMonths。
- schema-upgrade.ts 使用只新增字段的升级方式；旧数据库启动时先备份，再自动添加字段。
- 保留现有车辆和工单资料。

## 其他
- 版本升级至 0.3.16。
- 保留 v0.3.15 Split Payment TypeScript 类型修复。
- 完整 Prisma Client 生成、TypeScript typecheck、Next.js production build 和 Electron installer 仍须在 CI / Windows 环境验证。
