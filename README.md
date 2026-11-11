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
