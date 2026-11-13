# v0.3.27 — MyInvois CF410 phone normalization

- Normalize Malaysian shop and buyer phone numbers before building MyInvois UBL payloads.
- Convert local Malaysian numbers beginning with `0` to international `+60` format (for example, `0312345678` → `+60312345678`).
- Strip formatting spaces, hyphens, brackets and other non-number formatting characters; preserve a single leading `+`.
- Validate supplier phone length/format before submission and show a Settings validation message instead of sending an invalid Supplier Contact Telephone.
- Add automated tests for local landline/mobile numbers, already international numbers, `00` prefix and invalid values.

- 在生成 MyInvois UBL Payload 前，统一处理店铺与顾客电话号码。
- 马来西亚本地号码以 `0` 开头时自动转换为 `+60` 国际格式。
- 清除空格、横线、括号等格式符号，并保留开头的 `+`。
- 提交前验证供应商电话号码，避免无效的 Supplier Contact Telephone 送往 LHDN。
- 新增电话号码格式自动测试。
