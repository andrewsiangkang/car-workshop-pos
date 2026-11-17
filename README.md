# Workshop POS System

Local web-based POS and management system for a single-person car workshop.  
Supports quotations, invoices, receipts, and reports, with reserved support for Malaysia MyInvois e-Invoice.

---

## Install

**Shops: use the Windows installer** (`WorkshopPOS-Setup-x.y.z.exe` from the GitHub Releases page). It contains everything (no Node.js needed), keeps the data in your Windows user folder, makes automatic backups and updates itself safely.

The source install below is for technicians and for running on Mac / Linux.

### Source install (requirements)

- **Node.js 22 or newer** (24 LTS recommended): https://nodejs.org/
- Windows / Mac / Linux

### Windows
Double-click:
```
install.bat
```

### Mac / Linux
```bash
chmod +x install.sh start.sh
./install.sh
```

The install script:
1. installs the exact dependency versions from `package-lock.json` (`npm ci`);
2. generates the Prisma client;
3. creates `.env.local` with a random login secret (`AUTH_SECRET`) the first time, and an empty database in `data/workshop.db` (an existing database is never touched: the POS upgrades it itself at start, after a backup). An older source install whose `.env` has a `DATABASE_URL` (for example `file:./dev.db`, which is `prisma/dev.db`) keeps using that database; the install and start windows print which database file is used;
4. builds the production version once.

`.env.local` is private (git-ignored and never packaged): do not share it. Deleting it signs everybody out.

---

## Start (source install)

- Windows: double-click `start.bat`  ·  Mac / Linux: `./start.sh`
- Open **http://localhost:3000**

This runs the **production** server (`next start`), not the development server, and by default **only this computer** can open it (it listens on `127.0.0.1`).

- **Phones / tablets** (staff-only Wi-Fi only): add the line `WORKSHOP_LAN=1` to `.env.local` (or set the environment variable) and start again. The server then listens on every network.
- Port: a `PORT=3001` line in `.env.local` (default 3000).
- First visit: create the boss account. You need the **one-time setup code** printed in the start.bat / start.sh window (the desktop app needs no code). The database starts completely empty.
- `npm run dev` is for development only: it listens on every network and must not be used as the shop's server.

---

## 评估与路线图

所有评估与审计报告集中在 **[`docs/`](./docs/)**，方便找回：

| 文件 | 说明 |
|------|------|
| [`docs/CHANGELOG-v0.3.30-ZH.md`](./docs/CHANGELOG-v0.3.30-ZH.md) | 更新说明 v0.3.30（审查修复第 14 步，修复计划全部完成） |
| [`docs/CHANGELOG-v0.3.29-ZH.md`](./docs/CHANGELOG-v0.3.29-ZH.md) | 更新说明 v0.3.29（审查修复第 4–13 步） |
| [`docs/CODE-REVIEW-v0.3.27.md`](./docs/CODE-REVIEW-v0.3.27.md) | **最新代码审查**（v0.3.27，含修复计划和进度） |
| [`docs/REPORT-v0.3.3.md`](./docs/REPORT-v0.3.3.md) | 历史评估（v0.3.3） |
| [`docs/CHANGELOG-v0.3.12-ZH.md`](./docs/CHANGELOG-v0.3.12-ZH.md) | 更新说明 v0.3.12 |
| [`docs/AUDIT-v0.3.10-ZH.md`](./docs/AUDIT-v0.3.10-ZH.md) | 审计报告 v0.3.10 |
| [`docs/AUDIT-v0.3.6.md`](./docs/AUDIT-v0.3.6.md) | v0.3.6 安全修复记录 |
| [`docs/ROADMAP-v0.3.4.md`](./docs/ROADMAP-v0.3.4.md) | 任务清单（含 v0.3.5 已完成项） |
| [`docs/car-workshop-pos-audit-v0.3.4.pdf`](./docs/car-workshop-pos-audit-v0.3.4.pdf) | 审计报告 PDF · v0.3.4 |
| [`docs/car-workshop-pos-audit-v0.3.5.pdf`](./docs/car-workshop-pos-audit-v0.3.5.pdf) | 历史审计报告 PDF · v0.3.5 |

所有更新说明都在 `docs/CHANGELOG-*.md`。All release notes are in `docs/CHANGELOG-*.md`.

## Features

- **v0.3.12 hardening** — SQLite-backed login throttling, expanded audit events, integer-sen calculation primitives and production MyInvois submission lock until XAdES signing is available. See `docs/CHANGELOG-v0.3.12-ZH.md`.


- Work Orders with Quotation / Invoice / Receipt
- Customer & Vehicle management (auto-fill by plate number)
- **Inventory management** — spare parts stock, stock in/out, low stock alerts
- **Login protection** — set username & password on first run
- Mobile-friendly layout (works on phone browser)
- Reports and basic dashboard\n- **Customer service reminders** — track next service date / mileage, overdue and upcoming vehicles, mark service completed to calculate the next interval, and open WhatsApp with a prefilled reminder message.

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
- After updating, the database is upgraded automatically when the POS starts (a backup is made first; nothing is ever deleted). Do not run `npx prisma db push` on a shop database.
- Customer name is optional when creating a work order; plate + make/model are recommended.


## 手机 / 平板访问（v0.3.28 起默认关闭）/ Phone & tablet access

- 桌面版默认**只允许这台电脑**打开 POS（服务器只监听 `127.0.0.1`）。老板可在 **Settings → Phone / Tablet** 点 **Turn on** 打开，电脑会弹窗确认，然后自动重启内部服务器。打开后，同一 Wi-Fi 或 Tailscale 上的手机 / 平板才能连接。
- 设定保存在数据文件夹（和 `workshop.db` 同一个 `data` 文件夹）里的 `network-config.json`。旧版本升级后第一次启动会提示一次“手机访问已默认关闭”。
- **Wi-Fi 建议**：只在**员工专用的 Wi-Fi** 上打开手机访问；给顾客另开一个**访客 Wi-Fi（Guest Wi-Fi / 访客网络隔离）**，让顾客的手机连不到这台电脑。
- 收据 / 发票上的「顾客自助 e-Invoice」二维码只对能连到这台电脑的手机有效。手机访问关闭时（且没有设 `WORKSHOP_PUBLIC_URL`），这个二维码不会打印，发票页会显示原因。如果要让顾客扫码，可以让顾客用店里的平板填写，或在员工 Wi-Fi 上临时打开手机访问。
- 源码版（`start.bat` / `start.sh`）默认也只限本机；在 `.env.local` 加 `WORKSHOP_LAN=1` 才允许手机连接。`npm run dev` 是开发模式，会监听所有网络，不要当作店里的服务器使用。

- The desktop app now listens on this computer only by default. The boss turns phone / tablet access on in **Settings → Phone / Tablet** (confirmed in a desktop dialog; the internal server restarts).
- Only turn it on for a **staff-only Wi-Fi**. Put customers on a separate **guest Wi-Fi** that cannot reach the POS computer.
- While access is off, the customer e-Invoice request QR is not printed (customers' phones could not open it anyway).
- Source install (`start.bat` / `start.sh`): this computer only by default; `WORKSHOP_LAN=1` in `.env.local` turns phone access on.

## HTTPS / 店里的 Wi-Fi · HTTPS and the shop Wi-Fi

- 手机 / 平板连接 POS 时用的是普通的 **HTTP**（不加密）。同一个 Wi-Fi 上的其他设备理论上可以看到登录和资料，所以**手机访问只在员工专用的 Wi-Fi 上打开**，顾客用另一个访客 Wi-Fi；不需要时就保持关闭（默认关闭）。
- 手机、平板或其他电脑上的登录 **12 小时**后失效，店里这台电脑上是 7 天；登录 cookie 设为 HttpOnly、SameSite=Strict（用 HTTPS 打开时再加 Secure）。
- 不要在路由器做端口转发，也不要把 POS 放到公共网络上。店外使用请用 Tailscale（它本身是加密的）。
- 需要 HTTPS 的话，要在这台电脑上加一个反向代理（例如 Caddy）和证书（店内网络可用内部证书），这需要技术人员设置。
- Phones and tablets talk to the POS over plain **HTTP** (not encrypted): other devices on the same Wi-Fi could see logins and data. Keep phone access **off** unless the phones are on a **staff-only Wi-Fi**; put customers on a separate guest Wi-Fi.
- Logins on a phone, tablet or another computer expire after **12 hours** (7 days on the shop computer itself). The login cookie is HttpOnly and SameSite=Strict (and Secure when the page is opened over HTTPS).
- Never forward a router port to the POS or put it on the internet. For use outside the shop, use Tailscale (encrypted).
- HTTPS needs a reverse proxy on this computer (for example Caddy) with a certificate (an internal one is fine on the shop network). Ask a technician to set it up.


## 备份 / 还原 / 备份密码（v0.3.29）/ Backup, restore and the backup password

- **自动备份**：程序启动后、每隔设定的小时数、关闭程序时各备份一次，存放在数据文件夹的 `backups/auto`。备份由内部服务器用 SQLite `VACUUM INTO` 做一致性快照（程序正在写资料时也安全）。服务器已停止、或快照请求没被放行时，改用「经检查的文件复制」：复制前后确认没有写入中的日志文件、数据库文件头的修改计数和文件时间都没变，才保存这份备份；复制期间有资料写入（例如手机正在开单）就重试几次，仍不行就这次不备份并在设置页显示原因，绝不保存可能不完整的副本。设置页会显示用了哪种方式。
- **保留规则**：保留最近 N 份（设置里选）；另外一定保留最近 7 天每天一份、最近 12 个月每月一份，以及最新的 3 份「还原前安全副本」。升级前的备份（`backups/pre-upgrade`）不会被自动删除。
- **额外副本（USB / OneDrive / Google Drive）**：必须先在 **Settings → Backup** 设置**备份密码**（至少 8 个字符），副本会用它加密成 `.db.enc` 文件（scrypt + AES-256-GCM），上传的照片也一样加密。没有密码就不会往这个文件夹写任何副本。**请把密码写下来妥善保管**：忘记密码，谁都打不开这些副本。更改密码后，旧副本仍需要旧密码。旧版本留下的未加密副本可以在设置页一键删除。
- **还原**：在备份列表点 **Restore**，或点 **Restore from a backup file…** 选择本机备份、`.db` 文件或加密的 `.db.enc` 文件（会要求输入备份密码）。程序会先检查文件（SQLite 文件头 + `integrity_check`，包括索引），补回缺少的照片，然后先停止内部服务器、再保存一份当前资料的安全副本（这样手机在还原过程中保存的资料不会两边都丢；保存失败就不还原，程序重新启动、资料不变），然后替换数据库并重新启动。还原后服务器若无法打开新数据库，会自动放回还原前的资料。还原会记录在审计日志里（谁、从哪个文件、安全副本名称）。注意：备份之后开出的单据号码可能会被再次使用。
- **「Download Backup to Computer」** 下载的是**未加密**的 `.db` 文件（含全部顾客资料），每次下载都记入审计日志。请妥善保管，不需要时删除；放 USB / 云盘请用上面的加密额外副本。
- **MyInvois Client Secret** 在数据库里加密保存（AES-256-GCM）。钥匙是每台电脑首次运行时生成的，用 Windows（DPAPI / safeStorage）保护，存于数据文件夹的 `data-key.enc`，不在数据库里——所以数据库或备份被拿走也看不到密钥。把数据搬到另一台电脑后，需要在设置里重新输入 Client Secret。
- **日志**：内部服务器的输出写在数据文件夹的 `logs/server.log`（每个 5 MB，保留 3 个）。服务器崩溃会自动重启（间隔 1 秒、5 秒、15 秒、60 秒）；10 分钟内崩溃 5 次会停止并显示日志文件位置。
- **紧急还原（程序打不开时）**：如果程序启动失败，或 10 分钟内崩溃 5 次，提示框里有「还原备份…」：不需要登录，选择备份文件（加密的 `.db.enc` 会要求备份密码），程序先在独立进程里做完整性检查，确认后保存一份当前资料的安全副本（文件已损坏时原样保存在 `backups/damaged`），再替换并重新启动。技术支持也可以用 `修车店POS.exe --restore-backup` 直接进入这个流程。还原同样记录在审计日志里。
- **数据库自动升级**：新版本第一次启动时会先备份（`backups/pre-upgrade`），再自动加上新的栏位和表。升级失败会提示（资料不变，之后会自动再试）；旧资料里如果有重复的单据号码，会跳过「单号不重复」索引并显示一次说明，程序照常使用。

- Automatic backups are consistent SQLite snapshots (`VACUUM INTO`, taken by the embedded server), kept by count plus one per day for 7 days and one per month for 12 months. When the server is stopped or does not let the snapshot call through, a checked file copy is made instead: it is kept only if no write happened during the copy (no journal with saved pages, same change counter, size and file time before and after); otherwise it is retried and, if the database keeps changing, that backup fails and Settings → Backup says so. A possibly torn copy is never saved.
- Copies to a USB / OneDrive / Google Drive folder are always encrypted with the **backup password** set in Settings → Backup (`*.db.enc`); without a password nothing is written there. Keep the password safe: without it nobody can open those copies.
- **Restore from a backup file…** accepts a local auto backup, a `.db` file or a `.db.enc` file (asks for the password). The file is checked (SQLite header + `integrity_check`), missing photos are added, the server is stopped and a safety copy of the current data is saved (the restore stops, data unchanged, if it cannot be saved), the database is swapped in and the app restarts. Restores and backup downloads are recorded in the audit log.
- The MyInvois client secret is stored encrypted; the key lives outside the database, protected by Windows. Server logs: `data/logs/server.log`.
- **Emergency restore (the app will not start):** the "could not start" and "stopped 5 times" dialogs offer **Restore a backup…**. No login is needed: choose the backup file (the backup password is asked for `.db.enc`), the file is checked in a separate process (`integrity_check`), you confirm, a safety copy of the current data is kept (a damaged file is kept as it is in `backups/damaged`), the file is swapped and the app restarts. Support can also start it with `--restore-backup`. It is recorded in the audit log.
- **Database upgrade:** a new version backs up the database (`backups/pre-upgrade`) and adds the new columns and tables at start. A failure is reported (data unchanged, tried again automatically). If old records contain a duplicate document number, the "no duplicate numbers" index is skipped and a calm notice is shown once.
- Third-party licences: `THIRD-PARTY-NOTICES.md` and the `licenses/` folder with every bundled package's licence text plus the GNU GPL / LGPL v3 texts (both installed in the `resources` folder). After changing dependencies run `node scripts/collect-licenses.mjs` (`npm test` reports when `licenses/` is out of date).


## 自动检测新版本 / Updates

打包后的程序启动时会检查 GitHub Releases 有没有新版本（也可以在 Settings → Version & updates 手动检查）。

- 点「下载并安装」后，程序会下载新的安装程序，并和发布时附带的 **SHA-256 校验值**（`*.exe.sha256` / `latest.json`，由 GitHub Actions 生成）核对；GitHub 自己提供的校验值也必须一致。**不一致或没有校验值就删除、不安装。** 一致的话，程序先做最后一次备份再关闭，然后打开安装程序。
- 更新来源：环境变量 `UPDATE_REPO`（默认 `andrewsiangkang/car-workshop-pos`，设为空字符串即关闭检查）。

The installed app checks GitHub Releases for a new version at start (or Settings → Version & updates). **Download and install** downloads the installer and checks it against the SHA-256 published with the release by CI (`*.exe.sha256` / `latest.json`, and GitHub's own asset digest when present). A mismatch or a missing checksum means the file is deleted and nothing is installed. Otherwise the app makes its final backup, closes and opens the installer. `UPDATE_REPO` changes the repository (empty = no update check).


---

## 发布新版本（程序会自动提示更新）

1. 改 `package.json` 里的 `version`（例如 0.1.6），提交并推送。
2. 打标签并推送（标签要和版本号一致，前面加 v）：
   ```
   git tag v0.1.6
   git push origin v0.1.6
   ```
3. GitHub Actions 先跑类型检查（`tsc --noEmit`）、代码检查（eslint）和全部测试，再打包，然后把 `.exe`、`.exe.sha256` 和 `latest.json` 发布到 **Releases**（只有这一步有写入权限）。离线 OCR 文件缺少时打包会失败。
4. 店里的程序下次启动时会提示「有新版本」，点「下载并安装」：核对校验值后才安装，资料不会丢失。

注意：仓库必须是 **Public**，程序才读得到 Releases。更新依赖后请运行 `node scripts/collect-licenses.mjs`（`npm test` 会提示 `licenses/` 过期）。

### 代码签名（商业步骤）/ Code signing (a business step)

安装程序目前**没有数字签名**，Windows SmartScreen 会显示「未知发布者」。签名需要购买代码签名证书（OV / EV，或 Azure Trusted Signing 之类的云签名服务），证书要以公司名义（SSM 注册）申请并每年续费，这是业务决定，不是代码改动。拿到证书后，在 GitHub 仓库的 Secrets 里设置 `CSC_LINK` / `CSC_KEY_PASSWORD`（或云签名的配置），并去掉工作流里的 `CSC_IDENTITY_AUTO_DISCOVERY: "false"`，electron-builder 就会自动签名。在那之前，程序内更新靠上面的 SHA-256 核对防止下载被替换。

The installer is **not code-signed** yet, so Windows SmartScreen shows "Unknown publisher". Signing needs a code-signing certificate (OV / EV, or a cloud signing service such as Azure Trusted Signing) issued to the registered business and renewed yearly: a business decision, not a code change. With a certificate, add `CSC_LINK` / `CSC_KEY_PASSWORD` (or the cloud-signing settings) as repository secrets and remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from the workflow; electron-builder then signs the installer. Until then the in-app updater's SHA-256 check is what protects updates against a swapped download.

### 桌面运行环境 / Desktop runtime

桌面版使用 Electron 45（内置 Node.js 24 LTS）运行内部服务器。The desktop app runs on Electron 45 (Node.js 24 LTS inside). Electron supports only its three newest major versions: plan an Electron upgrade at least twice a year.

## 演示版（带示范资料）
GitHub → Actions → 选 **Build DEMO installer** → Run workflow。完成后在该次运行页面底部 Artifacts 下载 `WorkshopPOS-DEMO-Setup`。
演示版登录：用户名 `demo`（老板）和 `staff`（员工）。密码**不再固定**：每次打包随机生成，写在同一个 Artifact 的 `demo-login.txt` 里。注意：仓库是公开的，**任何登录 GitHub 的人都能下载 Artifact**，所以这只是演示用的一次性密码。也可以在仓库 Secrets 设置 `DEMO_OWNER_PASSWORD` / `DEMO_STAFF_PASSWORD`（至少 8 个字符，不要用你在别处用的密码）；这样设置的密码不会写进 `demo-login.txt`。本机打包演示数据时：`DATABASE_URL=file:./template.db node scripts/seed-demo.js` 会在窗口里显示一次随机密码。
演示版不会检查更新，**只允许本机访问**（不能打开手机访问），数据放在单独文件夹，可与正式版同时安装。正式版始终是空白数据。

Demo logins: `demo` (boss) and `staff`. Passwords are no longer fixed: random per build in `demo-login.txt` inside the artifact. The repository is public, so **any signed-in GitHub user can download that artifact**: treat them as throw-away demo passwords. Passwords set as the repository secrets `DEMO_OWNER_PASSWORD` / `DEMO_STAFF_PASSWORD` (never one you use elsewhere) are not written to `demo-login.txt`. The demo only listens on its own computer.

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
- **v0.3.3 LHDN e-Invoice QR**：提交后**自动轮询** LHDN 状态（约 2 秒起、每 4 秒一次、最多 12 次），拿到 Long ID 即停止并刷新，发票/收据底部显示验证二维码；仍可手动 Check Status。工单会保存 `submissionUid`，刷新页面后可继续轮询。未提交 LHDN 前，发票/收据显示**顾客请求 e-Invoice**二维码（连店内 Wi-Fi 扫码填 TIN）；提交并拿到 Long ID 后改为 **LHDN 验证**二维码。发票、收据、贷项通知（Credit Note）打印页在取得 Long ID 后显示 LHDN MyInvois 验证二维码（扫码打开官方 share 链接）。无 Long ID 时发票/收据显示占位提示；Credit Note 有 Long ID 才显示二维码。QR 由本地 `/api/qr` 生成，链接格式为 `{portal}/{uuid}/share/{longId}`。
- **v0.3.4**：版本号更新。含 v0.3.3 能力：提交后自动轮询 Long ID、工单保存 `submissionUid`（刷新可续查）、发票/收据「顾客请求 e-Invoice」与「LHDN 验证」两种二维码。评估报告见 `docs/REPORT-v0.3.3.md`，下一阶段任务见 `docs/ROADMAP-v0.3.4.md`。
- **v0.3.5**：设置页标明「未内置数字签名 / 正式环境风险」；LHDN 提交与查 TIN 错误人话化（中英）；完工开票时若有库存短缺（stock short）则在工单页提示；发票预览显示顾客请求 e-Invoice 的完整 URL，避免扫到 localhost。
  - 修复：关柜时现金**少了或多了**也能关柜（备注改为选填，差额照样记在结算单上）；老板的“留作明天的备用金”默认不会超过点出来的现金（以前现金少于开柜备用金时，按钮会被锁住）。关柜改为点两下确认，不再弹出浏览器对话框。
  - 修复：桌面版弹出确认 / 提示框后，输入框无法打字的问题（弹窗关闭后自动把键盘焦点还给窗口和原来的输入框）。
- 老板可在 Counter 页查看历史结算记录。
- 所有金额框都是手动输入，没有上下箭头。
- 旧数据库启动时自动升级（会先备份）；开发环境请执行 `npx prisma db push` 和 `npx prisma generate`。

- **v0.3.6**：修复二维码 API 未登录即可生成及公共缓存问题；新增 `npm run typecheck`。
- **v0.3.7**：新增老板专属 Audit Trail 页面/API，记录库存、工单、开票、收款及现金班次等关键操作；新增 `AuditLog` 数据表；修复 Electron 打包时缺少 `prisma/template.db` 的问题，打包前自动从 schema 生成模板数据库。旧数据库启动时会先备份，再自动添加 AuditLog 表；升级流程与验证清单见 `docs/AUDIT-v0.3.7.md`。



**Current source version:** see `version` in `package.json`.


## Latest build fix

See [v0.3.12 release notes (Chinese)](./docs/CHANGELOG-v0.3.12-ZH.md).


## v0.3.12
- Owner-editable quotation, invoice and receipt print templates.
- Receipt default print size is A5 landscape.
- Walk-in first: service reminders are follow-up reminders only, not appointment bookings.
