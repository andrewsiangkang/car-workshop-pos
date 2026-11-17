# v0.3.23 — CSV 数据导出 / CSV Data Export

- 报表页新增 “Export Data (CSV)”：发票、支出（按所选时间段）、客户、车辆、库存。
- 仅老板可下载；每次导出写入审计日志（DATA_EXPORTED）。
- 文件带 UTF-8 BOM，Excel 打开中文 / 马来文不乱码。
- 防 CSV 公式注入：文字以 `=` `+` `-` `@` 开头时前面补单引号；金额按数字输出，负数不受影响。
- 新增 `src/lib/csv-core.mjs`、接口 `/api/export/[kind]`、测试 `tests/csv-core.test.mjs`（6 项）。
- 验证限制：`node --test tests/*.test.mjs` 共 22 项通过；完整 TypeScript 检查与 Next.js production build 未在本环境执行，请在可联网的电脑上运行 `npm install` 与 `npm run build`。

- Reports page has a new "Export Data (CSV)" section: invoices and expenses (selected period), customers, vehicles, inventory.
- Owner-only; every export is written to the audit log (DATA_EXPORTED).
