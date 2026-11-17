# v0.3.24 — MyInvois 个人档案 NRIC / Individual taxpayer NRIC fix

- MyInvois: supplier ID scheme is now NRIC when the shop TIN starts with IG and the BRN field holds a 12-digit NRIC (individual taxpayer). Company profiles still use BRN.
- e-Invoice: when LHDN rejects a submission, the raw LHDN error is now shown under the button (prefixed with [LHDN]).
- Sidebar version label now matches package.json.

- MyInvois：个人档案（TIN 以 IG 开头，BRN 栏填 12 位 NRIC）卖家证件改用 NRIC；公司档案仍用 BRN。
- e-Invoice：提交被 LHDN 拒绝时，按钮下方显示 LHDN 原始错误（[LHDN] 开头）。
- 侧边栏版本号与 package.json 一致。
