Car Workshop POS v0.5.12
中文界面补全 + 源码审计材料

本次变更：
- 新增 216 条中文及马来文界面翻译，覆盖维修计划、车间作业、检查、技师工时、薪资单、佣金、QC、预约、接车登记、客户批准及部分单据页面。
- 新增关键中文翻译回归测试。
- 更新 package.json 与 package-lock.json 版本为 0.5.12。
- 附带源码审计报告 PDF / DOCX 和 Windows 一键完整审计脚本。

执行完整审计：
1. Windows 安装 Node.js / npm。
2. 解压项目。
3. 双击 RUN_FULL_AUDIT.cmd。
4. 将 audit-results/full-audit.log 交回检查。

注意：
- 当前只完成翻译词典静态检查：216 条新增词条均通过空值、重复冲突及占位符一致性检查。
- 本环境没有安装完整 npm 依赖，尚未执行 npm ci、完整测试、TypeScript、Lint、生产构建或 Windows 安装包构建。
- 不要在完整审计通过前创建正式 release tag。
