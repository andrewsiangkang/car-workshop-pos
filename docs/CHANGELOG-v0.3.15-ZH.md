# Car Workshop POS v0.3.15 — Split Payment TypeScript Build 修复

## 修复内容
- 为拆分付款行定义明确的 `SplitPaymentRow` 类型，明确金额、付款方式、现金实收、找零及参考编号的数据类型。
- 为 `reduce` 明确指定 `number` 累加器及回调参数类型，修复 GitHub Actions 在 TypeScript 类型检查阶段出现的 `Parameter 'sum' implicitly has an 'any' type`。
- 保留原有拆分付款金额验证、找零计算、事务写入及日结关联逻辑。
- 将应用版本更新为 `0.3.15`，同步 `package.json` 与 `package-lock.json`。

## 验证说明
- 已静态检查修改后的源码，确认不再使用未标注类型的 reduce 参数。
- 请在 Windows / GitHub Actions 执行 `npm ci`、`npm test` 和 `npm run build` 完成完整验证。
