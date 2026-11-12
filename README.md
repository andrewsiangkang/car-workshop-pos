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
- 老板可在 Counter 页查看结算记录并打印结算单；员工是“盲点”——只填点到的数字，看不到应有现金和差额（和系统“营业额只给老板看”的规则一致）。
- 旧数据库启动时自动升级（会先备份）；开发环境请执行 `npx prisma db push` 和 `npx prisma generate`。
