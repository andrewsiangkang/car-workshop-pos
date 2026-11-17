# Car Workshop POS v0.5.0 — 实施记录与发布门槛

## 唯一源码基础
- 用户提供的 v0.4.0 ZIP（版本 0.4.0）。
- 不合并其他源码分支，不重写现有 POS 核心。

## 本版已落地的模块（源码级）
1. Appointment 与 ServiceBay：本地预约、周视图日历、员工/工位冲突检查。
2. VehicleCheckIn 与 CheckInPhoto：里程、油量、钥匙、外观、随车物品及本地照片；上传时校验 JPEG/PNG/WEBP 文件签名。
3. InspectionTemplate / InspectionTemplateItem / VehicleInspection / InspectionFinding / InspectionPhoto：通用车辆检查模板、结果、严重程度、建议、备注及照片。
4. CustomerApproval / ApprovalLine：报价快照、版本、逐项批准/拒绝及有时效的安全链接；链接可由员工复制发送，不会自动发送。
5. TechnicianTimeLog：技师开始、暂停、恢复、结束工时。
6. PartReservation / PartIssue：预留与领用/退回分开；库存只在领用/退回时更新并写 StockMovement；领用/退回需要幂等键；退回量不能超过已领用未退回数量。
7. QCInspection / QCInspectionItem：质量检查；未通过 QC 不允许进入 READY；最终 QC 记录只读，返检应新建检查。
8. WorkOrder.workflowStage 与 WorkOrderStageHistory：维修阶段独立于财务 WorkOrderStatus。
9. SyncOutbox / SyncConflict：仅本地同步队列基础，本版没有云端传输服务。
10. 工单详情内的零件预留/领用/退回操作面板；技师工时管理页面；预约周视图。

## 迁移原则
- 仅新增列、表和索引；不 DROP、不重置、不覆盖旧 POS 数据。
- 旧工单 workflowStage 使用 LEGACY，不伪造历史阶段；新工单默认 WAITING。
- 先对生产数据库副本执行迁移、数量/金额对账及还原演练。
- workshop-photos 必须与 SQLite 数据库一起备份；备份模块已加入该目录的复制与还原处理。

## 已知限制 / 正式发布门槛
- 必须在完整安装依赖后执行 Prisma validate、Prisma generate、TypeScript typecheck、Next.js production build 和完整测试。
- 当前执行环境无法完整下载 npm 依赖，因此以上构建门槛尚未通过。
- Appointment 自动转工单、拖拽日历、Inspection PDF 导出、顾客电子签名采集 UI 尚未完成。
- Cloud Sync 尚未实现云端服务器、设备注册、租户身份、事件协议、传输安全及冲突处理 UI；不可宣传为已可用。
- Parts issue 当前按整笔预留数量领用；API 可分批退回，但 UI 当前提供整笔剩余数量退回。
- 安装包签名、Windows 实机安装、数据库迁移和备份还原演练仍需单独完成。
