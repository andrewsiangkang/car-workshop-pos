# Car Workshop POS v0.3.11 更新说明

## 本次根据门店实际工作方式调整

### 1. Walk-in 工作流程
- 门店目前以 walk-in 为主，不强制建立 Appointment / Booking。
- 车辆保养提醒的产品设计应为「到期提醒 / 顾客回访」，不应自动创建预约。
- 顾客收到提醒后可自行 walk-in；员工只在顾客实际到店时建立工单。

### 2. 老板可编辑单据打印格式
Settings → Document Templates（仅老板权限）新增：
- Quotation：编辑标题、页尾讯息、签名/确认区显示。
- Invoice：编辑标题、页尾讯息、签名区显示。
- Receipt：编辑标题、页尾讯息、签名区显示。
- Receipt 默认 A5 横向（Landscape），也可选择 A5 直向（Portrait）。
- 可统一选择是否显示顾客资料及车辆资料。
- 保存设置写入 ShopProfile.documentSettings，并写入 Audit Trail。

### 3. 旧数据库兼容
- schema.prisma 新增 ShopProfile.documentSettings。
- schema-upgrade.ts 只新增 TEXT 栏位，不删除或重写现有资料。
- 旧数据库第一次启动时由 schema upgrade 加入栏位。

## 验证状态
- 修改过的 TS / TSX 文件已通过 TypeScript transpile syntax parsing。
- SQLite 新增 documentSettings 栏位测试通过。
- 完整 npm install / Next.js build 尚未验证：npm ci 在当前环境超时，缺少项目依赖，不能宣称生产构建通过。
