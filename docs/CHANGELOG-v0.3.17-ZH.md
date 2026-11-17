# Car Workshop POS v0.3.17 — Full Daily Settlement

## 每日结算逻辑与显示优化
- Counter 页面新增 Total Daily Collections，合计现金、银行卡、银行转账、TNG / DuitNow QR 和其他付款方式的净收款。
- 明确区分现金收银柜结算与电子付款渠道结算。
- Cash to Bank In = 实际清点现金 − 次日收银柜保留本钱。
- Total Bank / Payment-channel Settlement = Cash to Bank In + 已通过银行卡 / QR / 转账渠道入账的非现金收款。
- 电子付款纳入每日总营业收款，但不会重复算进现金抽屉，也不会要求重复存入现金。
- 每日结算报告同步显示现金存银行、电子渠道已入账和总银行 / 支付渠道结算金额。
- 不自动扣除供应商、零件或其他营业成本；现金付款凭证仍按原有收银柜现金支出逻辑处理。

## 测试
- 新增 / 更新结算显示；需在 Windows / CI 执行完整 production build 验证。
