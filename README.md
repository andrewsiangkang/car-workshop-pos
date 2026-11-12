# Workshop POS System

Local web-based POS and management system for a single-person car workshop.  
Supports quotations, invoices, receipts, and reports, with reserved support for Malaysia MyInvois e-Invoice.

---

## Requirements

- **Node.js 18** or above  
  Download: https://nodejs.org/
- Windows / Mac / Linux

---

## One-click Install

### Windows
Double-click:
```
install.bat
```

### Mac / Linux
```bash
chmod +x install.sh
./install.sh
```

---

## Start

After installation, run:

```bash
npm run dev
```

Then open:

**http://localhost:3000**

First visit will ask you to set a username and password.  
Database starts completely empty.

---

## Features

- Work Orders with Quotation / Invoice / Receipt
- Customer & Vehicle management (auto-fill by plate number)
- **Inventory management** — spare parts stock, stock in/out, low stock alerts
- **Login protection** — set username & password on first run
- Mobile-friendly layout (works on phone browser)
- Reports and basic dashboard

## Boss vs Staff accounts

The first account created on first run is the **Boss** (OWNER). The boss adds staff in **Settings → Staff**.

| | Boss | Staff |
| --- | --- | --- |
| Work orders, quotation / invoice / receipt, customers, vehicles | ✅ | ✅ |
| Inventory (stock in/out, selling price) | ✅ | ✅ |
| Part **cost price** (inventory, work order lines) | ✅ | ❌ hidden |
| Dashboard collections / profit, Customer "Total Spent" | ✅ | ❌ hidden |
| Per-order cost & gross profit | ✅ | ❌ hidden |
| Reports | ✅ | ❌ |
| Settings, backup download, staff accounts | ✅ | ❌ |
| Delete inventory item | ✅ | ❌ |

Hidden data is never sent to staff browsers (enforced on the server, not just hidden in the UI).
Existing accounts are all Boss, so nothing changes until you add a staff account.
Accounts that already created work orders cannot be deleted (reset the password instead).

## Notes

- Invoice and Receipt include signature lines for both customer and workshop.
- Quotation (e-quotation) is computer-generated and does not require a signature.
- After updating, run `npx prisma db push` to sync the database schema (includes Inventory tables).
- Customer name is optional when creating a work order; plate + make/model are recommended.


## 自动检测新版本

打包后的 exe 启动时会自动检查新版本。

配置方式（二选一）：

1. 设置环境变量 `UPDATE_REPO` 为你的 GitHub 仓库，例如：
   ```
   UPDATE_REPO=yourname/car-workshop-pos
   ```
2. 或设置 `UPDATE_URL` 指向一个返回 JSON 的地址：
   ```json
   { "version": "0.1.2", "url": "https://example.com/download" }
   ```

发现新版本时会弹出提示，点击即可前往下载页面。


---

## 发布新版本（程序会自动提示更新）

1. 改 `package.json` 里的 `version`（例如 0.1.6），提交并推送。
2. 打标签并推送（标签要和版本号一致，前面加 v）：
   ```
   git tag v0.1.6
   git push origin v0.1.6
   ```
3. GitHub Actions 会自动打包，并把 `.exe` 发布到 **Releases**。
4. 店里的程序下次启动时会提示「有新版本」，点「下载」后运行安装程序即可，资料不会丢失。

注意：仓库必须是 **Public**，程序才读得到 Releases。

## 演示版（带示范资料）
GitHub → Actions → 选 **Build DEMO installer** → Run workflow。完成后在该次运行页面底部 Artifacts 下载 `WorkshopPOS-DEMO-Setup`。
演示版登录：`demo` / `demo12345`（老板），`staff` / `staff12345`（员工）。
演示版不会检查更新，数据放在单独文件夹，可与正式版同时安装。正式版始终是空白数据。

## 进货：供应商发票 / 供应商 / 付款凭证（仅老板）
- **供应商发票**：侧边栏 → Supplier Invoices → New / Scan Invoice。拍照或选图，离线识别文字（识别用的文件在打包时放进 `public/ocr`，见 `scripts/copy-ocr.js`），核对后保存 → 商品自动入库（库存里有同名/同 SKU 就加数量并更新成本价，没有就新建并按关键字分类）。同一供应商同一发票号不能重复录入。
- **供应商账户**：录入发票时自动建立；Suppliers 页可看联系方式、买过的商品和最近价格、低库存补货清单（可打印）。
- **付款凭证**：在供应商发票页点 Pay 生成（支持分期）；也可在 Payment Vouchers 页开独立凭证（租金、电费等）。可打印。
- 扫描识别只是“预填”，一定要核对每一行；识别不准可以手动改。

## 开柜 / 关柜结算（Counter）
- 侧边栏 → **Counter**：开柜时填备用金（钱箱里放的零钱）。**柜台开着才能收款 / 退款**。
- 收现金时填“Cash Received”，系统自动算出应找零；收据上会印 **Cash Received / Change**。
- 关柜时点清钱箱里**全部现金（含备用金）**填入，系统对比应有现金：
  - 应有现金 = 备用金 + 现金收款（已扣除找零）− 现金退款
  - 差额 = 点到的现金 − 应有现金（负数 = 短少 SHORT，正数 = 多出 OVER）
  - 刷卡 / Touch 'n Go / 银行转账不进钱箱，不算短少或多出，只在结算单里另外列出供核对。
- 关柜后自动生成**每日结算报告**（总收款、各付款方式、应有现金、点到现金、短少 / 多出、每笔付款明细），可打印 / 存 PDF。关柜的人（老板或员工）马上能看到短少或多出；有差额时必须写备注。
- **v0.2.4 每日结算增强**：
  - 开柜 / 关柜可以**按面额点钞**（RM100 × 几张、RM50 × 几张……含 50 / 20 / 10 / 5 sen 硬币），系统自动算总数；也可切换成“只填总数”。
  - 关柜时填**留给明天的备用金**（默认 = 今天开柜的备用金，例如 RM200）。**要存入银行的现金 = 点到的现金 − 留下的备用金**（例如点到 RM1200，留 RM200，存 RM1000）。这里**还没扣成本**（零件、供应商付款、开销）。
  - 结算单显示面额明细和存银行金额；老板可在结算单点 **Mark as Banked In**（可填银行单号）标记已存入；Counter 页的历史记录会显示每天“要存多少 / 存了没有”。
  - 第二天开柜时，系统会提示上次留下的备用金，一键套用。
- **v0.2.5**：
  - **从钱箱付出的现金**：在付款凭证（新建凭证 / 付供应商款）选 Cash 时，可勾选“Paid from the counter drawer”。勾选后这笔钱会从钱箱“应有现金”里扣掉，避免关柜时出现“短少”。需要先开柜。作废凭证后，还没关的柜台会自动加回来。
  - **老板专属**：存银行金额、留底备用金、标记已存入、成本与预估利润，**员工看不到**（员工关柜时备用金按开柜时的金额计算）。
  - **其他付款方式核对**：结算单里的刷卡 / Touch 'n Go / 转账，老板对照刷卡机或银行记录后逐项打勾；Counter 历史记录会显示还有几项待核对。
  - **成本与预估利润**（结算单，仅老板）：总收款 − 已售零件的预估成本 = 预估毛利；另列出当天付款凭证付出的钱和净现金流。这些只是估算，不含人工成本、之前买的库存和还没付的账单。
  - **手机 / 平板连接**：Settings → Phone / Tablet 显示这台电脑的地址（例如 http://192.168.1.5:端口）和二维码，手机连同一个 Wi-Fi 即可打开。
- **v0.2.6 自动登出**：5 分钟没有任何操作（鼠标、键盘、触屏、滚动）就自动登出；最后 30 秒弹出提醒，可点 Stay Logged In 继续。多个窗口共用同一个计时，电脑睡眠后醒来会立刻登出。登出不会关柜，也不影响已保存的数据。时间在 `src/lib/idle.ts` 修改。
- **v0.2.7 远程开单（店外使用）**：用 Tailscale（免费私人网络）。电脑和手机都装 Tailscale 并登录同一个账号，Settings → Phone / Tablet 会显示电脑的 Tailscale 地址和二维码，在外面打开手机上的 Tailscale 再用浏览器访问就能开单。程序现在用固定端口（正式版 3210，演示版 3211，被占用时才用随机端口），所以地址不会每次启动都变；也可以用环境变量 `WORKSHOP_PORT` 指定。**不要**在路由器上做端口转发，也不要放到公共隧道上。
- **v0.3.2 电子发票**：发票页可用顾客 NRIC / 护照 / SSM 向 LHDN 查 TIN（Find customer TIN by NRIC），保存后点 Submit to LHDN 即用该买家资料开电子发票（之后的 Credit Note 也用同一买家）。提交并拿到 Long ID 后，发票和收据底部会显示 **LHDN 验证二维码**，顾客扫码直接打开 LHDN MyInvois 上的这张电子发票。用买家资料开单的发票不会并入每月合并电子发票，月结页会列出。旧数据库启动时自动升级（会先备份）；开发环境请执行 `npx prisma db push` 和 `npx prisma generate`。
  - 修复：关柜时现金**少了或多了**也能关柜（备注改为选填，差额照样记在结算单上）；老板的“留作明天的备用金”默认不会超过点出来的现金（以前现金少于开柜备用金时，按钮会被锁住）。关柜改为点两下确认，不再弹出浏览器对话框。
  - 修复：桌面版弹出确认 / 提示框后，输入框无法打字的问题（弹窗关闭后自动把键盘焦点还给窗口和原来的输入框）。
- 老板可在 Counter 页查看历史结算记录。
- 所有金额框都是手动输入，没有上下箭头。
- 旧数据库启动时自动升级（会先备份）；开发环境请执行 `npx prisma db push` 和 `npx prisma generate`。
