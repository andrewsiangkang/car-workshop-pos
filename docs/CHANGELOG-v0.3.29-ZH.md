# v0.3.29 — Review fix plan steps 4–13 (all High items)

See `docs/CODE-REVIEW-v0.3.27.md` for the review. v0.3.28 fixed steps 1–3 (C1, C2). This version fixes steps 4–13: every High item (H1–H11), the CF410 phone issue (section V), and the Medium / Low items in the same files. Step 14 (the remaining Medium / Low items) comes next.

> The LHDN and PDPA points are a risk check, not legal advice. Have them confirmed by your tax agent or adviser.

## Read this before updating

- **Everyone signs in again once** after the update (sessions are now tied to the account's last change).
- **Log Out signs that account out on every device.** The 5-minute idle logout still signs out only the idle device.
- **The shop phone in Settings → Shop must be a real number** (e.g. `03-1234 5678`). "-" or "N/A" is refused before anything is sent to LHDN (LHDN error CF410).
- **USB / OneDrive / Google Drive backup copies need a backup password** (Settings → Backup). Without one, nothing is copied there. Old unencrypted copies can be deleted with one click. Keep the password safe: an encrypted copy cannot be opened without it.
- **Stock now comes off when the invoice is issued**, not at the quotation.
- **If you run the source version (start.bat / `npm run dev`)**, first-time setup asks for a one-time code printed in that window. The desktop app needs no code.

## LHDN e-Invoice (steps 4–7)

- **Sandbox and real e-Invoices are kept apart.** Every e-Invoice, credit note and consolidated e-Invoice records which LHDN system it went to. A sandbox test never counts as a real e-Invoice: it no longer blocks the real submission, the monthly consolidation or a cancellation. Printed documents with a sandbox result show a red "Sandbox test · Not a valid e-Invoice" banner. Old records are classified automatically on the first start. The audit log entry for the record's current UUID decides first. A reference typed in from the portal counts as real, even if the invoice had an earlier sandbox test. Otherwise an API submission counts as sandbox.
- **Check Status checks the right document.** It uses the submission saved on the record, or the UUID for references entered from the portal. It refuses if LHDN's answer belongs to another document or the other LHDN system. Each status change is written to the audit log with the old and new value.
- **Only the boss can type in an e-Invoice reference by hand.** A new UUID defaults to "MyInvois portal (real e-Invoice)". Replacing an existing live reference asks for confirmation first. A UUID already recorded on another invoice, credit note or consolidated e-Invoice is refused. A new reference stays "pending" until Check Status confirms it.
- **Recording a real e-Invoice releases a sandbox consolidation.** If the invoice was only in a sandbox test or rejected consolidated e-Invoice, it is taken out of it, and its credit notes no longer show as "netted".
- **Phone numbers in LHDN format (CF410).** "N/A", "-", "NIL", "0" etc. are sent as "NA". Several numbers in one box keep the first, extensions and "(0)" are removed, and local numbers get +60. A buyer phone LHDN would reject is shown before submitting. Staff can enter the buyer's phone when saving buyer details.
- **Monthly consolidated e-Invoice:**
  - It can be resubmitted after LHDN rejects it. The rejected attempt no longer blocks the month.
  - Invoices whose customer asked for their own e-Invoice (QR) or has a TIN on file are listed first. Once the month is over, any still without an e-Invoice go in as General Public, so the sale is still reported.
  - The boss can record a consolidated e-Invoice submitted in the MyInvois portal. It is checked against the invoices, credit notes and total shown (reload if a credit note was issued meanwhile). This option appears only when Settings are on Production.
- **Credit notes to LHDN** refer to the e-Invoice of the same LHDN system: the invoice's own, or the consolidated one. They list each credited item when the lines add up to the credit note, and otherwise send one summary line. The printed credit note follows the same rule. The buyer is the same one LHDN has; if the original went in the consolidated e-Invoice, that is General Public.
- **Customer QR form:**
  - It closes at the deadline (the 7th of the next month, Malaysia time), once the month is really consolidated, once the e-Invoice is issued, or once staff have entered the buyer details. The printed QR disappears at the same time.
  - It shows a full PDPA notice and requires a consent tick. The consent time and notice version are stored with the request.
  - LHDN's maximum field lengths are checked, and each field explains what is wrong.
- **Clearer LHDN errors.** When LHDN marks a document invalid, its reason (with the error code) and what to fix are shown. Phone, address, email, MSIC and shop-detail problems are no longer labelled as TIN problems. An amount such as 401.00 is no longer shown as "login failed".
- **The buyer can be edited when it should be, and only then.**
  - The invoice page locks once an invoice is in a real consolidated e-Invoice: its buyer can no longer be changed, and it cannot be submitted on its own.
  - When LHDN marks an e-Invoice invalid, cancelled or rejected, or after a sandbox test, staff can correct the buyer again and resubmit.
  - The buyer's address, postcode, city, state and email can be seen and edited next to the TIN lookup. Saving a different buyer no longer keeps the address, email or phone of the person who scanned the QR.

## Customers and walk-ins (step 8)

- **Walk-ins are no longer merged or renamed by mistake.** A blank or placeholder phone, including dummy numbers like 000-0000000, never matches another customer. The plate lookup no longer fills in "N/A".
- **A name change asks first.** If a different name is typed for a phone already on file, you choose to keep the old name or rename. Renames are written to the audit log.
- **Plates and phones are matched the same way everywhere.** "WXY 1234" = "WXY1234". "(012) 345-6789" = "0123456789". A blank make or model no longer overwrites the car's details with "Unknown".
- **A quantity of 0 or blank is refused.** It used to be charged as 1.

## Stock and credit notes (step 11)

- **Stock comes off when the invoice is issued.** If stock is short, you see which parts and can restock first or choose "Invoice anyway". Those parts are then recorded as owed, and Stock In still works while stock is below zero. Older jobs only take what they did not take at the quotation.
- **Credit notes by line.**
  - Choose the invoice lines and quantities. SST follows the invoice's own rate and scope, so with labour-only SST, returning a part no longer credits SST.
  - Returned parts can go back into stock with one tick, and their cost comes off the job's profit (work order, dashboard, reports, counter).
  - An amount-only credit with labour-only SST asks how much is labour and how much is parts, capped at what is left.
  - A confirmation shows the total and SST before issuing.
- **A cash-rounded invoice can be fully credited.** For example, RM100.02 paid as RM100.00 can be credited in full with RM100.00 refunded. A fully credited and refunded invoice no longer shows a 1–2 sen balance left over from the rounding.
- **Reports use each credit note's own SST** for SST collected and gross profit, so they match the work-order page with labour-only SST.
- **Switching a part line to Labour removes its inventory link**, so the line no longer carries a stock link that is never used.
- Very long numbers typed into a credit-note box show "Amount is too large" instead of breaking the page.

## Printed documents (step 12)

- **Issued documents keep their original details.** Invoices, receipts and credit notes reprint with the shop, customer and vehicle details from the day they were issued. Later changes to Settings, the customer or the car no longer change them. Documents issued before this version print as before.
- **The print shows the same buyer and SST number LHDN receives.** A credit note that refunds SST keeps the invoice's SST number.
- **SST invoices always show the SST particulars.** When SST is charged, the SST number, shop address, customer name, number and date always print, even if the template hides them.
- **The printed credit note lists the credited items.**

## Backups and restore (steps 9 and 13)

- **Restore is safe.**
  - The file is checked first (full SQLite integrity check).
  - The server is stopped, then a safety copy of today's data is saved. If that fails, nothing changes.
  - The app always restarts, and if the restored file will not open, the previous data is put back automatically.
  - Every restore is written to the audit log.
- **New "Restore from a backup file…"** works from this PC, a USB drive or a cloud folder (.db or encrypted .db.enc).
- **Backups are consistent.** Automatic backups use a consistent snapshot, including after the window has logged out for inactivity. If a consistent copy is not possible, the backup is marked as failed instead of saving a damaged file.
- **Off-PC copies and the MyInvois secret are encrypted.** Copies to USB, OneDrive or Google Drive are encrypted with the backup password. "Delete unencrypted copies" is offered only when a backup password is set and an encrypted copy really exists in that folder. Half-written backup files are cleaned up automatically. The MyInvois Client Secret is stored encrypted with a key kept by Windows. Downloaded backups and backup settings changes are audited.
- **Smarter retention.** Besides the latest N backups, one per day for a week and one per month for a year are kept, and the newest safety copies are always kept.
- **The app is more resilient.** It keeps a server log (`data/logs/server.log`). After a crash it restarts with growing waits, and stops with a clear message after 5 crashes in 10 minutes. Only https links open in the browser, and the window cannot be sent to other sites. First-time setup can no longer leave a half-copied database. Opening the app while it finishes its closing backup no longer shows an error.
- **Licence texts are included.** The installer includes `THIRD-PARTY-NOTICES.md` and the full licence texts of the bundled open-source parts (including the GPL / LGPL texts for libvips) in `resources/licenses`.

## Accounts and login (step 10)

- **The void and reset-password buttons work in the desktop app.** Voiding a supplier invoice or voucher, and resetting a staff password, open an in-page dialog. The new password is entered twice, hidden, with at least 8 characters.
- **Disable an ex-staff account.** The person is signed out everywhere and cannot sign in until the account is enabled again. Their records are kept.
- **Role changes ask for confirmation.** Changing staff ⇄ boss, disabling and enabling are audited with before and after values.
- **Stronger login lock.** Parallel guesses cannot get past it. After 5 wrong passwords the username is locked for 30 seconds, doubling up to 15 minutes. The shop computer has its own separate lock, so a phone or tablet can never lock the boss out of the shop computer, even with phone access on.
- **First-time setup** is only possible on the shop computer, or with the one-time code when running the source version. With the source version, the desktop-app proof and the internal backup token can no longer be forged from the public development secret.
- Missing Chinese and Malay translations were added for the new e-Invoice form labels and error messages.

## Checks done for this version

- `npx tsc --noEmit` clean. `npm test`: 221 / 221 pass (v0.3.28 had 31 tests; the new ones are mostly behaviour tests of the new pure modules). `npm run build` succeeds.
- End-to-end test with a copy of a v0.3.27 shop database (63 checks), including:
  - automatic upgrade: the new columns and tables match a fresh database exactly; old e-Invoices are classified sandbox or real correctly; the MyInvois secret is sealed;
  - the old boss login and every main page;
  - a quotation followed by short stock, "Invoice anyway", Stock In, and a credit note by line returning the part to stock;
  - the printed credit note;
  - the shop phone "-" being refused;
  - a backup snapshot with nobody logged in;
  - idle logout vs Log Out;
  - the login lock with phone access on, and the desktop window still signing in.
- Each change was implemented, reviewed by a separate reviewer and fixed. A final cross-check of the whole version by five independent reviewers found 18 more problems where the parts meet. Each one was confirmed by a second checker and fixed (all are included above), and every check was run again.
- `npm run lint`: 16 older problems remain in files not touched by this version; they are part of step 14.

---

# v0.3.29 — 审查修复计划第 4–13 步（全部 High 项）

完整审查见 `docs/CODE-REVIEW-v0.3.27.md`。v0.3.28 已完成第 1–3 步（C1、C2）。本版本完成第 4–13 步：全部 High 项（H1–H11）、CF410 电话问题（第 V 节），以及同一批文件里的 Medium / Low 项。第 14 步（其余 Medium / Low 项）接着做。

> LHDN 和 PDPA 相关内容只是风险检查，不是法律意见，请让税务代理或顾问确认。

## 更新前请先看

- **更新后所有人需要重新登录一次。**
- **点「登出」会让该账号在所有设备上登出。** 5 分钟无操作的自动登出只登出那一台设备。
- **设置 → Shop 里的店铺电话必须是真实号码**（例如 `03-1234 5678`）。填 "-" 或 "N/A" 会在发送前被拦下（LHDN 错误 CF410）。
- **复制到 U 盘 / OneDrive / Google Drive 的备份需要先设置备份密码**（设置 → Backup）。没设密码就不会复制。旧的未加密副本可以一键删除。请保管好密码，没有密码就打不开加密备份。
- **库存改为开发票时才扣**，不是报价时扣。
- **用源码版运行（start.bat / `npm run dev`）时**，第一次设置需要输入窗口里显示的一次性设置码。桌面版不需要。

## LHDN 电子发票（第 4–7 步）

- **沙盒测试和正式电子发票分开记录。** 每张电子发票、退款单、合并电子发票都记录送去了哪个 LHDN 系统。沙盒测试不算正式电子发票：不会挡住正式提交、每月合并或取消。有沙盒结果的单据打印时有红色「沙盒测试 · 不是有效的电子发票」提示。旧记录在第一次启动时自动分类：先看审计日志里对应目前这个 UUID 的记录；从门户手动填的编号算正式（就算之前做过沙盒测试）；否则用 API 提交的算沙盒。
- **「检查状态」查的是正确的单据。** 用记录里保存的提交编号查，门户手动填的按 UUID 查。如果 LHDN 返回的是别的单据或另一个系统的结果，会拒绝。每次状态变化都写入审计日志（旧值和新值）。
- **只有老板能手动填电子发票编号。** 新 UUID 默认选「MyInvois 门户（正式电子发票）」。替换已经有效的编号要先确认。已经登记在别的发票、退款单或合并发票上的 UUID 会被拒绝。新编号在「检查状态」确认前保持「待确认」。
- **登记正式电子发票会解除沙盒合并。** 发票原本只在沙盒测试或被拒绝的合并发票里，登记后会自动解除关联，它的退款单也不再显示为「已扣除」。
- **电话号码转成 LHDN 格式（CF410）。** "N/A"、"-"、"NIL"、"0" 等送 "NA"。一格里有几个号码只取第一个，去掉分机号和 "(0)"，本地号码加 +60。买方电话不合格会在提交前提示。店员保存买方资料时可以填买方电话。
- **每月合并电子发票：**
  - 被 LHDN 拒绝后可以重新提交，被拒绝的那次不会再挡住这个月。
  - 顾客扫码要了自己的电子发票、或客户资料里有 TIN 的发票，会排在前面提示。月份结束后，仍没有电子发票的，以 General Public 并入合并发票，销售照样申报。
  - 老板可以登记在 MyInvois 门户提交的合并电子发票。系统会核对页面显示的发票、退款单和总额（期间有新退款单就要重新载入）。只在设置为正式环境（Production）时显示。
- **退款单提交 LHDN** 时引用同一个 LHDN 系统里的电子发票：原发票自己的，或包含它的合并发票。各行加起来等于退款单金额时逐项列出退款项目，否则送一行摘要；打印的退款单也用同一个规则。买方和 LHDN 那边一致；原发票是并入合并发票的，就是 General Public。
- **顾客扫码表格：**
  - 在截止日（次月 7 号，马来西亚时间）、该月已真正合并、电子发票已开出、或店员已填好买方资料后关闭。发票上的二维码同时不再打印。
  - 显示完整的 PDPA 个人资料声明，必须打勾同意。同意时间和声明版本跟申请一起保存。
  - 按 LHDN 的长度上限检查，每一格写明哪里不对。
- **LHDN 错误更清楚。** 单据被判无效时，显示 LHDN 的原因（含错误代码）和怎么改。电话、地址、电邮、MSIC、店铺资料的问题不再显示成 TIN 问题。金额里有 401 之类的数字也不再误报成「登录失败」。
- **买方资料该改时能改，不该改时锁定。**
  - 发票已并入正式合并电子发票后，发票页面锁定：不能再改买方，也不能单独提交。
  - 电子发票被 LHDN 判为无效、已作废、已拒绝，或者只是沙盒测试时，店员可以再改买方资料并重新提交。
  - 买方的地址、邮编、城市、州属和电邮可以在 TIN 查询旁边查看和修改。保存另一个买方时，不会再留着扫码人的地址、电邮或电话。

## 客户和散客（第 8 步）

- **散客不再被错误合并或改名。** 空白或占位电话（包括 000-0000000 这类假号码）不会配到别的客户。查车牌不再自动填 "N/A"。
- **改名会先问。** 同一个电话输入了不同名字时，会让你选择保留旧名或改名。改名会写入审计日志。
- **车牌和电话到处用同一个规则配对。** "WXY 1234" = "WXY1234"，"(012) 345-6789" = "0123456789"。车型留空不会再把车辆资料改成 "Unknown"。
- **数量 0 或空白会被拒绝。** 以前会按 1 收费。

## 库存和退款单（第 11 步）

- **开发票时才扣库存。** 库存不足时会列出缺哪些零件，可以先进货或选择「照样开发票」，那些零件就记为欠货，库存低于 0 时也能照常进货。旧工单只扣报价时没扣的部分。
- **退款单按项目开。**
  - 选择发票上的项目和数量，SST 按原发票的税率和范围计算。只收工钱 SST 时，退零件不会退 SST。
  - 退回的零件可以一键放回库存，成本也从这张工单的利润里扣掉（工单、首页、报表、收银结算）。
  - 只收工钱 SST 时按金额开退款单，要分别填工钱和零件金额，并且不能超过剩余可退的金额。
  - 开出前会显示总额和 SST，让你确认。
- **现金进位过的发票也能全额退。** 例如 RM100.02 收 RM100.00 的发票，可以全额退款单并退回 RM100.00。全额退款并退钱后，也不会再多出 1–2 仙的余额。
- **报表按每张退款单实际退的 SST 计算**已收 SST 和毛利，只对工钱收 SST 时与工单页一致。
- **零件行改成工钱时会取消库存关联**，不会留下一个永远用不到的库存链接。
- 在退款单栏位输入超长数字时，提示「金额太大」，不会让页面出错。

## 打印单据（第 12 步）

- **已开出的单据保留开出当天的资料。** 发票、收据、退款单补印时，用开出当天的店铺、客户、车辆资料。之后改设置、客户或车辆都不会影响。本版本之前开的单据照旧打印。
- **打印的买方和 SST 号码跟送给 LHDN 的一样。** 退 SST 的退款单保留原发票的 SST 号码。
- **SST 发票一定显示 SST 资料。** 收了 SST 时，SST 号码、店铺地址、客户名字、单号和日期一定会印出，模板设置隐藏也没用。
- **退款单打印时列出退款的项目。**

## 备份和还原（第 9、13 步）

- **还原更安全。**
  - 先检查备份文件（完整的 SQLite 完整性检查）。
  - 停止服务器后，先保存今天资料的安全副本；保存失败就什么都不改。
  - 程序一定会重启；还原的文件打不开，会自动换回原来的资料。
  - 每次还原都写入审计日志。
- **新增「从备份文件还原…」**，可以从本机、U 盘或云盘文件夹还原（.db 或加密的 .db.enc）。
- **备份一致。** 自动备份用一致性快照，窗口因闲置登出后也一样。做不到一致性复制时，这次备份标记为失败，不会存一个坏文件。
- **离开电脑的备份和 MyInvois 密钥都加密。** 复制到 U 盘、OneDrive、Google Drive 的备份用备份密码加密。只有设置了备份密码、而且那个文件夹里确实有加密副本时，才提供「删除未加密副本」。没写完的备份文件会自动清理。MyInvois Client Secret 用 Windows 保管的密钥加密保存。下载备份、修改备份设置都会记录。
- **保留策略更合理。** 除了最近 N 份，再保留一周内每天一份、一年内每月一份，最新的安全副本一定保留。
- **程序更稳定。** 程序会保存服务器日志（`data/logs/server.log`）。崩溃后会等待更长时间再重启，10 分钟内崩溃 5 次就停止并提示。只有 https 链接会在浏览器打开，窗口不会被带到别的网站。第一次安装不会留下复制一半的数据库。关闭时正在做最后备份，再打开程序也不会报错。
- **附带许可证全文。** 安装包附带 `THIRD-PARTY-NOTICES.md`，以及 `resources/licenses` 里所有开源组件的许可证全文（包括 libvips 的 GPL / LGPL）。

## 账号和登录（第 10 步）

- **作废和重设密码按钮在桌面版能用了。** 作废供应商发票、凭单，重设员工密码时，都在页面里弹出对话框。新密码要隐藏输入两次，至少 8 个字符。
- **可以停用离职员工的账号。** 停用后立即在所有设备登出，重新启用前不能登录，记录都保留。
- **修改角色要先确认。** 员工 ⇄ 老板的修改、停用、启用都记入审计日志（修改前后）。
- **登录锁定更严格。** 同时猜密码也绕不过去。连续 5 次密码错误锁定该用户名 30 秒，每次加倍，最长 15 分钟。店里电脑有自己单独的锁定，手机或平板永远锁不住店里电脑上的老板账号，打开手机访问时也一样。
- **第一次设置**只能在店里电脑上做；用源码版运行时需要一次性设置码。源码版运行时，桌面程序证明和内部备份签名也不能再用公开的开发密钥伪造。
- 补上新电子发票表格标签和错误信息缺少的中文、马来文翻译。

## 本版本的检查

- `npx tsc --noEmit` 无错误；`npm test` 221 / 221 通过（v0.3.28 只有 31 个测试，新增的大部分是新模块的行为测试）；`npm run build` 成功。
- 用 v0.3.27 旧数据库副本做端到端测试（63 项），包括：
  - 自动升级：新增的栏位和表跟全新数据库完全一致，旧电子发票正确分成沙盒或正式，MyInvois 密钥已加密；
  - 旧老板账号登录和各主要页面；
  - 报价后库存不足、「照样开发票」、进货、按项目开退款单并放回库存；
  - 退款单打印；
  - 店铺电话 "-" 被拒绝；
  - 没人登录时的备份快照；
  - 闲置登出和手动登出的区别；
  - 打开手机访问时的登录锁定，以及店里电脑照样可以登录。
- 每项修改都经过实现、独立审查、再修正。最后由五个独立审查员对整个版本做交叉检查，在各部分衔接处又找到 18 个问题，每个都经过第二人确认后修好（已写在上面），然后全部检查重新跑一遍。
- `npm run lint`：还剩 16 个旧问题，都在本版本没动过的文件里，归入第 14 步。
