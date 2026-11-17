# v0.3.30 — Review fix plan step 14 (all remaining Medium / Low items)

See `docs/CODE-REVIEW-v0.3.27.md` for the review. v0.3.28 fixed steps 1–3 and v0.3.29 fixed steps 4–13. This version fixes step 14, the last step: every remaining Medium and Low item. With it, the whole fix plan is done.

> The LHDN, PDPA and tax points are a risk check, not legal advice. Have them confirmed by your tax agent or adviser.

## Read this before updating

- **The desktop app now runs on Electron 45 (with Node.js 24).** The old Electron 33 no longer gets security fixes. Your data, backups and saved passwords are kept.
- **Phones and tablets now stay signed in for 12 hours** (the shop computer still 7 days), because the shop Wi-Fi connection is not encrypted.
- **Only cash is rounded to 5 sen.** Card, Touch 'n Go and bank transfer are charged to the exact sen. With a split payment only the cash part is rounded.
- **Closing the counter is a blind count.** Count the drawer and enter it first; the expected cash and any shortage or overage appear after you submit.
- **"Delete" on a stock item now archives it.** Its history is kept and it can be brought back with "Show archived" → Restore. An item that still has stock, or is used by a quotation or job not yet invoiced, cannot be archived.
- **WhatsApp service reminders are only offered for customers who agreed to them.** Existing customers have no agreement on record yet: when a customer agrees, tick it on the customer page or the reminders page.
- **Credit notes to LHDN:** a credit note with no money back goes as a credit note (02), one fully refunded goes as a refund note (04). A credit note that refunds only part of its amount cannot be sent to LHDN: issue two credit notes instead (one fully refunded, one with no refund). The app warns you before you issue one.
- **Updates are checked before installing.** From this version, Settings → Version & updates installs a new version only if the download matches the SHA-256 fingerprint published with the release. A release without one is not installed.
- **Source install (install.bat / start.bat) users:** run install.bat once more. It now builds and runs the fast production version, opens only on this computer unless phone access is turned on on purpose, and creates its own random login secret (everyone signs in again once). Your existing database is kept.
- **If old records have the same invoice, receipt or quotation number twice,** the app shows a one-time notice (also saved as `upgrade-warnings.txt` in the data folder). Nothing is changed or deleted; ask support to look at those records.

## Money, counter and reports

- **Cash rounding:** the 5-sen rounding applies only to the cash part of a bill (see above). The receipt now says "Cash Rounding (nearest RM0.05)" and "Total Paid after Cash Rounding".
- **Tax and money rounding is exactly half-up to the sen** (for example 6% of RM36.25 is RM2.18). Invoices already issued are not changed.
- **New boss-only Expenses page** (rent, utilities, wages and so on): add an expense, see the list by month, and void an entry with a reason. Nothing is ever deleted.
- **Reports count operating expenses:** Expenses-page entries, payment vouchers that do not pay a supplier invoice, and delivery or service charges on supplier invoices. The Expenses page explains the rule so nothing is entered twice.
- **Reports and the dashboard count money in the month it was actually received**, and a refund in the month it was paid back. A refund or credit note issued later no longer changes months that are already over. A fully refunded job still counts the cost of parts that did not come back to stock.
- **Malaysia time everywhere:** reports, the dashboard's "today" and "this month", CSV exports and dates on screen use Malaysia time, whatever time zone the PC is set to.
- **Counter day report:**
  - Closing the counter freezes that day's settlement report, so voiding a voucher later can no longer make a closed day stop adding up. Such vouchers are listed on that day's report, and no cash is added back to any drawer.
  - Days closed before this version are frozen the first time one of their vouchers is voided, and the report says which voids are already left out of its figures.
  - Staff can no longer see the bank deposit or the voucher payees; only the boss can.
- **Voiding a supplier invoice** also puts back the cost and selling prices it changed, unless a later invoice or an edit changed them again (the audit log says which).
- **Cancelling a job or changing its status** re-checks everything at the moment of saving, so a payment or invoice made at the same time cannot slip past.

## Stock

- "Delete" archives (see above). Archived items are hidden from lists, part pickers and a supplier's reorder list.
- A job that uses an archived part asks for the part to be restored before the invoice is issued, and a new work order cannot add an archived item.
- Cancelling a job, or a credit note that returns parts to stock, brings an archived item back automatically (recorded in the audit log).
- The inventory table scrolls sideways on phones, so the Actions buttons are always reachable.

## LHDN e-Invoice

- **Refund notes (04)** as described above. The LHDN type is shown on the credit note list and on the printed credit note.
- **Each invoice, credit note and monthly e-Invoice is sent to LHDN only once.** A double click or a second computer can no longer create a duplicate.
- **The app waits at most 30 seconds for LHDN.** If LHDN does not answer, the document shows "waiting for LHDN's answer" instead of "failed". Press Check Status; sending again is blocked until LHDN shows whether it got it. While a document is in that state, its buyer cannot be changed, the job cannot be cancelled and no reference can be typed in for it.
- **Check Status** only looks at the time around when the document was sent, so it gives a reliable answer even weeks later, and it no longer mistakes an earlier invalid copy for the new one.
- **Monthly consolidated e-Invoice:**
  - An invoice whose own e-Invoice (or credit note) is still being sent or waiting for LHDN's answer is kept out until you press Check Status, so the same sale is never reported twice.
  - It stays under LHDN's 300 KB size limit: with many invoices it lists them as continuous number ranges (for example INV20261001001 - INV20261031045), with the same totals to the sen.
- **Buyer details:**
  - A Malaysian customer with an IC no longer needs a TIN, on the QR form or on the staff form. The e-Invoice then uses LHDN's general TIN for individuals with the IC number. Companies, passports and army IDs still need a TIN.
  - The buyer's ID number is checked for its type (IC, SSM number, passport, army ID) before anything is sent, and the message says which field to fix.
  - Your shop's 12-digit SSM number is sent to LHDN as a business registration number (BRN), not as an IC number.
  - If a buyer with a TIN has no valid ID number on an invoice already at LHDN, the credit note screen explains that this credit note must be issued in the MyInvois portal.
- **Every TIN lookup is recorded in the audit log** (who, ID type, only the last 4 digits, found or not).
- **Customers waiting more than 3 days for their own e-Invoice** are shown in red on the e-Invoice page and on the boss's dashboard.
- On a source install that only this computer can open, the customer e-Invoice QR code is no longer printed (customers' phones could not open it).

## Privacy (PDPA) and the audit log

- **Tamper-evident audit log:** each entry is linked to the one before it, and the boss can press "Verify audit trail" to check that nothing was changed, deleted or reordered.
- **More is recorded:** changes to shop, tax and print-template settings with the old and new values (the MyInvois secret only as "changed"); failed logins, locked accounts, refused set-ups, logins to disabled accounts and "log out everywhere" (passwords never). The device's real network address is recorded; an address a device claims for itself is only noted as "reported".
- **Each customer has their own page** where the boss can correct their details (including address), download all their data as a file, or anonymise them at their request.
  - Anonymising keeps every invoice and amount. Invoices, receipts and credit notes still within the 7-year keeping period keep printing the customer's details.
  - The boss must first confirm the record-keeping duty; a customer with a job still in progress cannot be anonymised.
  - Settings → Privacy: choose how many years to keep customer records (at least 7, or off), see how many customers have not visited for that long, and anonymise them.
  - Every export, correction and anonymisation is recorded in the audit log.
- **Staff accounts no longer receive** customers' IC / ID numbers, TIN, e-mail or address in job lists. The boss still sees everything.
- **Customer address** (address, postcode, city, state, checked against LHDN limits) is printed on new invoices and sent on e-Invoices.
- **WhatsApp reminders** are only offered for customers who agreed and have not opted out. Messages are written in English, Chinese or Malay to suit the customer, and never greet a walk-in by a placeholder name.
- **After a backup is restored**, job, quotation, invoice, receipt, credit note, supplier invoice and payment voucher numbers used before the restore are never issued again, and the audit log lists e-Invoices already at LHDN that are no longer in the restored data so you can re-enter them. The restore confirmation now says this.

## Screens and languages

- On the invoice, receipt, quotation, credit note and payment voucher pages, the buttons, notes, e-Invoice form and error messages follow your chosen language. The printed document itself stays in English, as LHDN and your customers receive it. The payment voucher now prints correctly (it printed blank before).
- Hundreds of on-screen and server messages that stayed in English now show in Chinese and Malay. Malay screens use "Kerja" for work orders everywhere.
- **New Work Order drafts:** a half-filled new work order is saved on this computer as you type (per user, never with cost prices, for up to 3 days). After an automatic logout or a closed window, the page offers "Restore draft" or "Discard draft". The 5-minute logout warning says when a draft was kept.
- On a phone, the Work Orders list keeps the Amount column on screen.

## Desktop app, backups and updates

- Electron 45 and update checking as described above. The demo version says it does not install updates.
- **Emergency restore:** if the POS cannot start, the desktop app can restore a backup without logging in. It checks the backup, asks you to confirm (and for the backup password if the backup is protected), keeps a safety copy of the current data, then restarts. These restores are marked as emergency restores in the audit log.
- If a database upgrade fails, it is tried again at the next start, or every 10 minutes while the app runs. Failed tries no longer leave full database copies that fill up the disk. The backup made when you close the app is no longer slowed down by such a retry.

## Source install, demo and build

- Source install: production version, this computer only by default, random login secret, existing database kept; the install and start windows show which database file is in use.
- Demo version: no fixed passwords (new random ones for each build) and it only opens on its own computer.
- The installer build uses exact package versions, runs all checks and tests first, has only the permissions it needs, and stops if the offline invoice-scanning files are missing.
- README: notes on plain HTTP and the shop Wi-Fi, the 12-hour phone login, code signing and planning engine upgrades.

## Checks done for this version

- `npx tsc --noEmit` clean. `npm test`: 477 / 477 pass. `npm run lint`: 0 problems (the 16 older ones are fixed). `npm ci` from the new lockfile and `npm run build` succeed.
- `npm audit --omit=dev` still lists the Prisma command-line tool (through `deepmerge-ts`, used only when Prisma reads its own config at build and upgrade time, never with shop or customer data). The fix needs Prisma 7, a major upgrade left for a later version.
- End-to-end test with a copy of a v0.3.27 shop database, with the server running on Electron 45's own Node.js 24 as in the desktop app (90 checks, all pass), including:
  - the automatic upgrade: every new column, table and index matches a fresh database, no upgrade warning on clean data;
  - the old boss login and every main page, including Expenses, Counter, Reminders and the customer page;
  - the stock / invoice / credit note flow from v0.3.29;
  - archiving and restoring a stock item, and a new job refusing an archived item;
  - recording and voiding an expense;
  - an IC buyer without TIN, a company without TIN being refused, and the "being sent to LHDN" guards;
  - the waiting-request alert on the dashboard;
  - audit trail verification, customer export and anonymisation (the issued invoice still prints the customer);
  - a staff login that receives no IC numbers or cost prices;
  - a restore that retires the numbers issued after the backup, and new numbers after it;
  - the login lock with phone access on;
  - an old database with a duplicated invoice number: a calm notice, the app still starts;
  - the review-round fixes: the sidebar shows v0.3.30, an unknown-username login and a customer rename leave no personal data in the audit log, the audit trail still verifies, and the server log shows no errors.
- Each change was implemented, reviewed by a separate reviewer and fixed. A final cross-check of the whole version by five independent reviewers then looked for problems where the parts meet (see below). The last round's fixes (credit-note and report maths) were checked by their own new tests, a random test of 20,000 invoices and this end-to-end test, not by another review round.

## Found and fixed by the final cross-check

Five independent reviewers checked the whole version where its parts meet (25 problems found). Five more review rounds then checked each round's fixes (11, 9, 5, 6 and 7 problems found), with a second reviewer trying to disprove every finding before it was fixed. Everything they confirmed is fixed:

**Money and reports**

- **Invoices issued before this update keep the rounding they were issued with.** Their individual e-Invoice matches the printed total to the sen, and a credit note against them credits exactly the stored total and SST, line by line.
- The "labour still to credit" hint beside the split credit boxes shows all the labour left (it could show a few sen less).
- **Top Selling Work Items, Technician Performance and Revenue Mix** count only money actually received in the period and agree with each other after any credit note (by line, split or amount only). A refund is not counted as a sale, returned parts are not counted as sold, and a job paid over two months is split between them.
- Operating expenses include the tax paid on supplier invoices ("Tax on supplier invoices"), and a supplier invoice dated in a later month counts only in that month.
- Recording a supplier invoice adds stock to the item with the same SKU first, then to an item in use with the same name, and only last to an archived item.
- **Credit notes on invoices with SST on labour only:** parts or labour already taken back by a split (labour + parts) credit note can no longer be credited again, by split or by line. Crediting exactly the "Left to credit" amounts closes the invoice in full (no stray 1 sen of SST). A labour line credited a few hours at a time is no longer refused at the last hour, and the SST of the partial credits adds up exactly to the SST on that line.
- **Reports after credit notes:** Revenue Mix and Top Selling still agree after a goodwill (amount-only) note followed by a line credit and after crediting all the labour (no few sen left over). A small part inside a split credit note counts as a part, free (RM0) items are counted in Top Selling quantities, and a job fully credited and refunded where cash rounding covered the last sen still counts parts not returned to stock as a cost.

**LHDN e-Invoice**

- Invoice page: adding a company's BRN or a customer's IC number starts from the name, phone and address already printed on the invoice, so saving no longer erases the address.
- After going live, an old unanswered sandbox test no longer blocks recording a real e-Invoice or the monthly consolidated e-Invoice, no longer locks the buyer, and no longer leaves a Check Status button on a credit note already netted in the month. The invoice page explains that such a test can only be checked with Settings on Sandbox.
- If the app was closed while sending an e-Invoice, a Check Status button appears to settle it. Until then the buyer stays locked.
- A UUID already recorded on an invoice, a credit note or a month is refused, and the message says where it is recorded. A new boss-only **Remove reference** button removes a UUID typed in by mistake (the old values stay in the audit log).
- **Monthly consolidated e-Invoice entered from the MyInvois portal:**
  - The document number can be typed exactly as the portal shows it, including spaces and #.
  - If it differs from LHDN's, Check Status corrects it, as long as LHDN confirms the document is your consolidated e-Invoice (buyer General Public, same total).
  - A UUID that LHDN does not know is set aside, so the month can be recorded again with the right details. One later lookup that finds nothing no longer releases a document LHDN has already confirmed.
- A buyer TIN of 000000 counts as no TIN, so the printed invoice and LHDN always show the same buyer.

**Privacy and the audit log**

- The audit log no longer keeps a customer's names when they are renamed, their postcode, city, state or reminder language, or the typed username (or its length) of a failed login with an unknown username, which is often a password typed into the wrong box.
- Anonymising a customer also clears their buyer details on documents already past the 7-year keeping period. Documents of anonymised customers still inside the period are cleared automatically once it ends. This runs in the background at start-up; a customer that cannot be cleared is noted in the audit log and tried again at the next start.
- Settings → Privacy always uses and shows the saved number of years; a changed value must be saved first.

**Desktop app, start-up and release**

- After an emergency restore done while the database was being written, numbers issued after the backup are still retired and lost e-Invoices are still listed. A briefly locked temporary file no longer loses that list, and leftover temporary copies are removed after a day.
- The app no longer waits for the privacy clean-up before it opens.
- The dashboard and e-Invoice page show the real number of customers waiting for their own e-Invoice (it stopped at 50).
- Version 0.3.30. The sidebar always shows the installed version.
- The automatic Windows build on GitHub no longer fails a licence test because of line endings (no installer would have been published), and the empty-database template is created correctly when the folder path has spaces.

---

# v0.3.30 — 审查修复计划第 14 步（其余全部 Medium / Low 项）

完整审查见 `docs/CODE-REVIEW-v0.3.27.md`。v0.3.28 完成第 1–3 步，v0.3.29 完成第 4–13 步。本版本完成最后的第 14 步：其余全部 Medium 和 Low 项。至此整个修复计划全部完成。

> LHDN、PDPA 和税务相关内容只是风险检查，不是法律意见，请让税务代理或顾问确认。

## 更新前请先看

- **桌面版改用 Electron 45（内置 Node.js 24）。** 旧的 Electron 33 已不再有安全更新。资料、备份和已保存的密码都保留。
- **手机和平板登录 12 小时有效**（店里电脑仍是 7 天），因为店里 Wi-Fi 上的连接没有加密。
- **只有现金按 5 仙进位。** 刷卡、Touch 'n Go、银行转账按实际金额收；拆分付款时只有现金部分进位。
- **关柜改为盲点。** 先点钱、输入金额；提交后才显示应有现金和短款 / 长款。
- **库存项目的「删除」改为「归档」。** 进出库记录保留，勾选「显示已归档」后可以恢复。还有库存、或有没开发票的报价单 / 工单在用的项目不能归档。
- **WhatsApp 保养提醒只发给同意接收的客户。** 现有客户还没有记录同意：客户同意时，请在客户页面或提醒页面勾选。
- **退款单送 LHDN：** 没退钱 → 贷项通知（02）；全数退回 → 退款通知（04）。只退一部分钱的退款单不能送 LHDN，请改开两张（一张全数退回、一张不退钱）。开单前系统会提醒。
- **安装更新前会先核对。** 从这个版本起，「设置 → 版本与更新」只会安装和发布时附带的 SHA-256 校验值一致的下载；没有校验值的版本不会安装。
- **源码版（install.bat / start.bat）用户：** 请再运行一次 install.bat。现在会打包并运行正式版（更快），默认只有这台电脑能打开（要手机访问必须明确开启），并自动生成随机登录密钥（所有人需要重新登录一次）。原来的数据库会保留。
- **如果旧资料里有重复的发票 / 收据 / 报价单号，** 程序只显示一次提示（也存为数据文件夹里的 `upgrade-warnings.txt`），不会修改或删除任何资料；请联系技术支持查看那些记录。

## 金额、收银柜和报表

- **现金进位：** 5 仙进位只用在账单的现金部分（见上）。收据现在写「Cash Rounding (nearest RM0.05)」和「Total Paid after Cash Rounding」。
- **税额和金额的四舍五入精确到分**（例如 RM36.25 的 6% 是 RM2.18）。已开出的发票不变。
- **新增只有老板能用的「开支」页面**（房租、水电、工资等）：新增开支、按月份查看、作废时填写原因，记录永远不会被删除。
- **报表计入营业开支：** 开支页的记录、不是支付供应商发票的付款凭证、供应商发票上的运费或服务费。开支页上写明了规则，避免重复记账。
- **报表和首页按钱实际收到的月份计算**，退款算在退钱的那个月。之后才开的退款或退款单不会再改动已经过去的月份；整张退款但零件没有放回库存的工单，零件成本照样计算。
- **一律用马来西亚时间：** 报表、首页的「今天」和「本月」、CSV 导出和屏幕上的日期，不受电脑时区影响。
- **收银日报表：**
  - 关柜时冻结当天的结算报表，之后作废付款凭证不会让已关柜那天的数字对不上；这些凭证列在那天的报表上，也不会把现金加回钱柜。
  - 这个版本之前关柜的日子，会在第一次作废它的凭证时冻结，报表会注明哪些作废已经不包括在数字里。
  - 店员看不到银行存款金额和付款凭证的收款人，只有老板能看到。
- **作废供应商发票**时，它改过的成本价和售价会恢复；如果之后又被别的发票或手动修改过就保持不变（审计日志会注明）。
- **取消工单或改状态时**会在保存那一刻重新检查，同时付款或开发票也不会被绕过。

## 库存

- 「删除」改为归档（见上）。已归档的项目不会出现在列表、选零件的地方和供应商补货清单。
- 工单用到已归档的零件时，开发票前会提示先恢复；新工单不能加入已归档的项目。
- 取消工单、或退款单把零件放回库存时，已归档的项目会自动恢复显示（记录在审计日志里）。
- 手机上的库存表格可以左右滑动，操作按钮不会被挡住。

## LHDN 电子发票

- **退款通知（04）**如上所述；退款单清单和打印的退款单上会显示 LHDN 类型。
- **发票、退款单和每月合并电子发票只会送 LHDN 一次**，连按两下或另一台电脑同时提交也不会重复。
- **最多等 LHDN 30 秒。** LHDN 没回应时显示「等 LHDN 回应」而不是「失败」；请按「检查状态」，确认之前不能重送。单据在这个状态时，不能改买方、不能取消工单，也不能手动登记参考号。
- **「检查状态」**只查送出前后那段时间，几个星期后再按也可靠；不会再把之前一份无效的单据当成这次的。
- **每月合并电子发票：**
  - 发票自己的电子发票（或退款单）还在送出或等 LHDN 回应时，先不放进合并发票，按「检查状态」确认后才处理，同一笔交易不会申报两次。
  - 不会超过 LHDN 每份 300 KB 的上限：发票很多时按连续号码分段列出（例如 INV20261001001 - INV20261031045），总额精确到仙不变。
- **买方资料：**
  - 持马来西亚身份证的顾客不用填 TIN（扫码表格和店员表格都一样），电子发票会用 LHDN 个人通用 TIN 加身份证号码；公司、护照、军人证仍须填 TIN。
  - 送出前按证件类型检查买方证件号码（身份证、SSM 号码、护照、军人证），并说明要改哪一栏。
  - 店铺 12 位数的 SSM 号码以公司注册号（BRN）送 LHDN，不会再被当成身份证号码。
  - 买方有 TIN 却没有合格证件号码、而发票已在 LHDN 时，开退款单的画面会说明这张要在 MyInvois 网站开。
- **每次查询 TIN 都记录在审计日志里**（谁查的、证件类型、只显示最后 4 位、有没有查到）。
- **要求个别电子发票超过 3 天还没开出的顾客**会用红色显示在电子发票页面和老板的首页上。
- 只有这台电脑能打开的源码版，不再打印顾客电子发票二维码（顾客手机本来也打不开）。

## 隐私（PDPA）和审计日志

- **审计日志可以发现篡改：** 每条记录都和上一条连在一起，老板按「检查审计日志」就能确认没有记录被修改、删除或调换顺序。
- **记录得更完整：** 店铺、税务、打印模板设置的修改前后内容（MyInvois 密钥只记「已修改」）；登录失败、账号被锁、被拒绝的初始设置、停用账号尝试登录、「所有设备登出」（绝不记录密码）。记录设备真实的网络地址，设备自己报的地址只当作「自称」。
- **每位客户有自己的页面**，老板可以更正资料（包括地址）、下载这位客户的全部资料，或应客户要求匿名化。
  - 匿名化保留所有发票和金额；还在 7 年保存期内的发票、收据和退款单照旧印出客户资料。
  - 老板必须先确认了解保存义务；有进行中工单的客户不能匿名化。
  - 「设置 → 隐私」：选择客户资料保留几年（至少 7 年，或关闭），先看有几位客户超过年限没来过，再把他们匿名化。
  - 每次导出、更正或匿名化都会写进审计日志。
- **员工账号在工单列表里不会再收到**客户的身份证 / 证件号码、TIN、电邮和地址；老板照样看得到全部资料。
- **客户地址**（地址、邮编、城市、州属，按 LHDN 限制检查）会印在新发票上，也会送到电子发票。
- **WhatsApp 提醒**只发给同意而且没有退订的客户；信息按客户选用英文、中文或马来文，也不会用散客的占位名字称呼客户。
- **还原备份之后，** 还原前已经用过的工单、报价单、发票、收据、退款单、供应商发票和付款凭证号码不会再被开出；审计日志会列出已在 LHDN、但还原后的资料里没有的电子发票，方便重新登记。还原确认框的说明也已更新。

## 画面和语言

- 发票、收据、报价单、退款单和付款凭证页面上的按钮、说明、电子发票表格和错误信息跟随你选的语言；打印出来的单据本身保持英文（LHDN 和顾客收到的就是英文）。付款凭证现在可以正常打印（以前印出来是空白的）。
- 几百条以前只有英文的画面和服务器信息现在有中文和马来文；马来文界面统一用「Kerja」称呼工单。
- **新工单草稿：** 填到一半的新工单会边填边存在这台电脑上（按用户分开、不存成本价、最多 3 天）。被自动登出或关掉窗口后，再打开可以选「恢复草稿」或「放弃草稿」；5 分钟登出提醒会说明草稿已保存。
- 手机上的工单列表不再切掉「金额」栏。

## 桌面程序、备份和更新

- Electron 45 和更新核对如上所述；演示版会说明不会安装更新。
- **紧急还原：** POS 无法启动时，桌面程序可以不登录直接还原备份：先检查备份，再请你确认（加密备份要输入备份密码），先给现有资料留一份安全副本，然后重启。审计日志会标明这是紧急还原。
- 数据库自动升级失败时，下次启动会再试，程序运行期间最多每 10 分钟再试一次；失败的尝试不会再留下完整的数据库副本占满硬盘。关闭程序时的最后备份不会再因此变慢。

## 源码版、演示版和打包

- 源码版：正式版、默认只限这台电脑、随机登录密钥、保留原来的数据库；安装和启动窗口会显示正在使用哪个数据库文件。
- 演示版：没有固定密码（每次打包随机生成），只能在安装它的电脑上打开。
- 打包安装程序时使用确切的依赖版本，先跑完所有检查和测试，只给需要的权限；缺少离线扫描发票的文件就停止打包。
- 说明文件：新增店内 Wi-Fi 与 HTTP 不加密、手机 12 小时登录、代码签名和运行环境升级计划的说明。

## 本版本的检查

- `npx tsc --noEmit` 无错误。`npm test`：477 / 477 通过。`npm run lint`：0 个问题（旧的 16 个已修好）。用新的 lockfile 执行 `npm ci` 和 `npm run build` 都成功。
- `npm audit --omit=dev` 仍列出 Prisma 命令行工具（经由 `deepmerge-ts`，只在打包和升级时读取 Prisma 自己的设置，从不接触店铺或客户资料）。修复需要升级到 Prisma 7（大版本），留待以后的版本。
- 用一份 v0.3.27 店铺数据库的副本做端到端测试，服务器和桌面版一样用 Electron 45 自带的 Node.js 24 运行（90 项检查，全部通过），包括：
  - 自动升级：所有新栏位、新表和索引都和全新数据库一致，干净的资料不会出现升级提示；
  - 旧老板账号登录和所有主要页面，包括开支、收银柜、提醒和客户页面；
  - v0.3.29 的库存 / 发票 / 退款单流程；
  - 库存项目归档和恢复，新工单拒绝已归档的项目；
  - 新增和作废开支；
  - 身份证买方不填 TIN、公司不填 TIN 被拒绝，以及「正在送 LHDN」的各项保护；
  - 首页的等待申请提醒；
  - 检查审计日志、导出和匿名化客户（已开出的发票仍印出客户资料）；
  - 员工账号拿不到身份证号码和成本价；
  - 还原后停用备份之后开出的号码，之后的新单据用新号码；
  - 打开手机访问时的登录锁定；
  - 旧数据库里有重复的发票号：只显示平和的提示，程序照常启动；
  - 审查轮次的修改：侧边栏显示 v0.3.30，不存在的用户名登录失败和客户改名不会在审计日志留下个人资料，审计日志仍检查通过，服务器日志没有错误。
- 每项修改都经过实现、另一位审查员审查、再修复。最后由五位独立审查员交叉检查整个版本各部分衔接的地方（见下）。最后一轮的修改（退款单和报表的计算）由新增的测试、20,000 张随机发票的测试和这次端到端测试检查，没有再做一轮审查。

## 最后交叉检查发现并已修好的问题

五位独立审查员检查了整个版本各部分衔接的地方（发现 25 个问题）；之后又有五轮审查检查每一轮的修改（分别发现 11、9、5、6、7 个问题），每个发现在修改前都另有一位审查员尝试推翻。确认的问题全部已修好：

**金额和报表**

- **本次更新前开出的发票，保持开票时的四舍五入方法。** 单张电子发票和打印的总额分毫不差；对这些发票开退款单时，退的总额和 SST 刚好等于发票上存的，并逐行列出。
- 拆分退款旁边「还可以退的工钱」显示发票上剩下的全部工钱（以前可能少几分钱）。
- **热销项目、技师业绩和营收结构**只计算本期间实收的钱，开了任何退款单（按行、拆分或只填金额）之后三者仍然对得上。退款不算销售，退回的零件不算卖出，跨两个月付清的工单分摊到两个月。
- 营业开支包括供应商发票上付的税（「供应商发票上的税」）；日期在以后月份的供应商发票只算进它自己的月份。
- 录入供应商发票时，库存先加到 SKU 相同的商品，再到在用的同名商品，最后才是已归档的同名商品。
- **只对工钱收 SST 的发票开退款单：** 已用「工钱 + 零件」拆分退款退过的零件或工钱，不能再用拆分或按行退第二次；按「剩余可退」的金额全额退，会把发票完全退清（不会留下 1 分 SST）；工钱行分几次按小时退时，最后一小时不会再被拒绝，分次退的 SST 加起来刚好等于该行的 SST。
- **开退款单后的报表：** 先开只填金额的优惠退款单、再按行退，或退掉全部工钱之后，营收结构和热销项目仍然一致（不再残留几分钱）；拆分退款里的小零件算零件；免费（RM0）项目计入热销数量；整单退款并退钱、而最后 1 分被现金进位抵掉时，没放回库存的零件仍算成本。

**LHDN 电子发票**

- 发票页：补填公司 BRN 或顾客身份证号时，买方栏位先填入发票上已印的名字、电话和地址，保存时不会再把地址清掉。
- 正式上线后，旧的沙盒测试没回应不会再挡住登记正式电子发票或每月合并电子发票，不会锁住买方，已扣进当月合并发票的退款单也不会再一直显示「检查状态」。发票页会说明这种测试只能在设置切回沙盒后检查。
- 送电子发票时程序被关掉的，会出现「检查状态」按钮来处理；处理前买方保持锁定。
- 已登记在发票、退款单或某个月的 UUID 会被拒绝，讯息会说明登记在哪里。新增只限老板的 **「移除编号」** 按钮，可移除手动填错的 UUID（原来的资料记在审计日志里）。
- **从 MyInvois 网站登记的每月合并电子发票：**
  - 单号可以照网站显示的输入，包括空格和 #。
  - 如果和 LHDN 的单号不一样，只要 LHDN 确认这份就是您的合并发票（买方 General Public、总额相同），按「检查状态」会改成 LHDN 的单号。
  - LHDN 不认识的 UUID 会被搁置，可以用正确资料重新登记该月；LHDN 已确认有效的合并发票，不会因为之后某一次查不到就被放开。
- 买方 TIN 填 000000 当作没有 TIN，打印的发票和 LHDN 一定是同一个买方。

**隐私和审计日志**

- 审计日志不再保存改名时的客户名字、客户的邮编 / 城市 / 州属 / 提醒语言，也不再保存用不存在的用户名登录失败时输入的文字或它的长度（那常常是输错栏位的密码）。
- 匿名化客户时，已超过 7 年保存期的单据上的买方资料一并清除；还在保存期内的，期满后自动清除。清理在启动时于后台进行；清除失败的客户会记在审计日志里，下次启动再试。
- 「设置 → 隐私」一律按已保存的年限执行并显示出来；改了年限要先保存。

**桌面程序、启动和发布**

- 在数据库正在写入时做的紧急还原，之后仍会停用备份后开出的单号，也仍会列出遗失的电子发票；临时文件被短暂锁住也不会丢失这份清单，遗留的临时副本一天后会删除。
- 程序打开时不再等隐私清理完成。
- 首页和电子发票页显示等待个别电子发票的真实顾客人数（以前最多 50）。
- 版本 0.3.30；侧边栏一定显示安装的版本号。
- GitHub 上的 Windows 自动打包不会再因为换行格式让许可证测试失败（以前根本不会发布安装程序）；文件夹路径有空格时，空白数据库模板也能正确生成。
