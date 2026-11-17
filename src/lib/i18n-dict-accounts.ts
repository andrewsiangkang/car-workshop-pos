// v0.3.29 translations added by the "accounts" fixes: [English, 中文, Bahasa Melayu].
// Kept in its own file so several changes can add rows without touching i18n-dict.ts.
export const ROWS: Array<[string, string, string]> = [
  // In-page dialogs (src/components/ui/Dialog.tsx)
  ["Please wait...", "请稍候...", "Sila tunggu..."],
  ["Confirm", "确认", "Sahkan"],
  ["OK", "确定", "OK"],
  ["Reason", "原因", "Sebab"],
  ["Type the new password again", "再输入一次新密码", "Taip kata laluan baharu sekali lagi"],
  ["Please fill this in", "请填写这一项", "Sila isi ruangan ini"],
  ["Must be at least 8 characters", "至少要 8 个字符", "Mesti sekurang-kurangnya 8 aksara"],
  ["The two passwords do not match", "两次输入的密码不一样", "Kedua-dua kata laluan tidak sama"],

  // Void dialog (supplier invoices / payment vouchers): these texts are now shown in the page, not in prompt()
  [
    "Void this voucher? The supplier invoice will show this amount as unpaid again. The record is kept.",
    "作废这张付款凭证？供应商发票上这笔金额会重新显示为未付。记录会保留。",
    "Batalkan baucar ini? Invois pembekal akan menunjukkan jumlah ini sebagai belum dibayar semula. Rekod disimpan.",
  ],
  [
    "Void this voucher? The record is kept and marked VOID.",
    "作废这张付款凭证？记录会保留并标记为「已作废」。",
    "Batalkan baucar ini? Rekod disimpan dan ditanda BATAL.",
  ],
  [
    "Void its payment vouchers first (open each voucher below).",
    "请先作废它的付款凭证（打开下面每一张凭证）。",
    "Batalkan baucar bayarannya dahulu (buka setiap baucar di bawah).",
  ],
  [
    "Void this supplier invoice? Its items will be taken back out of stock. The record is kept.",
    "作废这张供应商发票？发票上的货品会从库存中扣回。记录会保留。",
    "Batalkan invois pembekal ini? Barangannya akan dikeluarkan semula dari stok. Rekod disimpan.",
  ],
  ["Please give a reason for voiding", "请填写作废原因", "Sila berikan sebab pembatalan"],
  ["Already voided", "已经作废了", "Sudah dibatalkan"],

  // Staff accounts panel
  ["Account created:", "账号已创建：", "Akaun dicipta:"],
  ["Password updated for", "已更新密码：", "Kata laluan dikemas kini untuk"],
  ["Now a Boss account:", "已改为老板账号：", "Kini akaun Bos:"],
  ["Now a Staff account:", "已改为员工账号：", "Kini akaun Staf:"],
  ["Account disabled:", "账号已停用：", "Akaun dinyahaktifkan:"],
  ["Account enabled:", "账号已启用：", "Akaun diaktifkan:"],
  ["Make this account a Boss?", "把这个账号改成老板？", "Jadikan akaun ini Bos?"],
  [
    "A Boss sees cost prices, profit, reports and settings, and can manage every account. They will need to sign in again.",
    "老板可以看到成本价、利润、报表和设置，并能管理所有账号。对方需要重新登录。",
    "Bos boleh melihat harga kos, untung, laporan dan tetapan, serta boleh mengurus semua akaun. Mereka perlu log masuk semula.",
  ],
  ["Make Boss", "改成老板", "Jadikan Bos"],
  ["Change this account to Staff?", "把这个账号改成员工？", "Tukar akaun ini kepada Staf?"],
  [
    "They will no longer see cost prices, profit, reports or settings. They will need to sign in again.",
    "对方将看不到成本价、利润、报表和设置。对方需要重新登录。",
    "Mereka tidak lagi dapat melihat harga kos, untung, laporan atau tetapan. Mereka perlu log masuk semula.",
  ],
  ["Change to Staff", "改成员工", "Tukar kepada Staf"],
  ["Disable this account?", "停用这个账号？", "Nyahaktifkan akaun ini?"],
  [
    "They are signed out on every device at once and cannot sign in until you enable the account again. Their work orders and records are kept.",
    "对方会立刻在所有设备上被登出，在你重新启用之前都无法登录。工单和记录都会保留。",
    "Mereka akan dilog keluar daripada semua peranti serta-merta dan tidak boleh log masuk sehingga anda mengaktifkan semula akaun ini. Kerja dan rekod mereka disimpan.",
  ],
  ["Disable account", "停用账号", "Nyahaktifkan akaun"],
  ["Enable this account again?", "重新启用这个账号？", "Aktifkan semula akaun ini?"],
  ["They can sign in again with their existing password.", "对方可以用原来的密码重新登录。", "Mereka boleh log masuk semula dengan kata laluan sedia ada."],
  ["Enable account", "启用账号", "Aktifkan akaun"],
  ["Delete this account?", "删除这个账号？", "Padam akaun ini?"],
  [
    "This cannot be undone. Accounts that already have work orders cannot be deleted; disable them instead.",
    "删除后无法恢复。已有工单的账号不能删除，请改为停用。",
    "Tindakan ini tidak boleh dibatalkan. Akaun yang sudah ada kerja tidak boleh dipadam; nyahaktifkan sahaja.",
  ],
  ["You", "你", "Anda"],
  ["Disabled", "已停用", "Dinyahaktifkan"],
  ["Enable", "启用", "Aktifkan"],
  ["Disable", "停用", "Nyahaktifkan"],
  ["Disabled accounts", "已停用的账号", "Akaun yang dinyahaktifkan"],
  [
    "These people cannot sign in. Their work orders and records are kept.",
    "这些人无法登录。他们的工单和记录都会保留。",
    "Mereka ini tidak boleh log masuk. Kerja dan rekod mereka disimpan.",
  ],
  ["New password for", "新密码，账号：", "Kata laluan baharu untuk"],
  [
    "At least 8 characters. They will be signed out everywhere and must use the new password.",
    "至少 8 个字符。对方会在所有设备上被登出，之后要用新密码登录。",
    "Sekurang-kurangnya 8 aksara. Mereka akan dilog keluar di semua peranti dan perlu guna kata laluan baharu.",
  ],
  ["New password", "新密码", "Kata laluan baharu"],
  ["Save new password", "保存新密码", "Simpan kata laluan baharu"],

  // Account API messages shown in the panel
  ["You cannot remove your own boss access", "不能取消你自己的老板权限", "Anda tidak boleh membuang akses bos anda sendiri"],
  ["You cannot disable your own account", "不能停用你自己的账号", "Anda tidak boleh menyahaktifkan akaun anda sendiri"],
  ["At least one active Boss account is needed", "至少要保留一个可以登录的老板账号", "Sekurang-kurangnya satu akaun Bos yang aktif diperlukan"],
  ["Account not found", "找不到这个账号", "Akaun tidak dijumpai"],
  ["Invalid request", "请求无效", "Permintaan tidak sah"],
  ["Invalid role", "角色无效", "Peranan tidak sah"],
  ["Failed to update account", "更新账号失败", "Gagal mengemas kini akaun"],
  ["Name cannot be empty", "名字不能为空", "Nama tidak boleh kosong"],
  ["Username already exists", "用户名已存在", "Nama pengguna sudah wujud"],
  ["Password must be at least 8 characters", "密码至少要 8 个字符", "Kata laluan mesti sekurang-kurangnya 8 aksara"],
  [
    "This account already has work orders on record, so it can't be deleted. Disable it instead to lock the person out; the records are kept.",
    "这个账号已经有工单记录，不能删除。要让此人无法登录，请改为停用；记录会保留。",
    "Akaun ini sudah ada rekod kerja, jadi tidak boleh dipadam. Nyahaktifkan akaun untuk menghalang orang itu log masuk; rekod disimpan.",
  ],

  // Login
  ["Invalid username or password", "用户名或密码错误", "Nama pengguna atau kata laluan salah"],
  ["Username and password required", "请输入用户名和密码", "Nama pengguna dan kata laluan diperlukan"],
  [
    "This account has been disabled. Ask the boss to enable it again.",
    "这个账号已被停用。请老板重新启用。",
    "Akaun ini telah dinyahaktifkan. Minta bos mengaktifkannya semula.",
  ],
  // "Too many failed attempts…": the wait is 1–15 minutes.
  ...Array.from({ length: 15 }, (_, i): [string, string, string] => [
    `Too many failed attempts. Try again in ${i + 1} minute(s).`,
    `失败次数太多，请 ${i + 1} 分钟后再试。`,
    `Terlalu banyak cubaan gagal. Cuba lagi dalam ${i + 1} minit.`,
  ]),

  // First-run setup
  [
    "First-time setup can only be done on the shop computer itself. Open the POS app on that computer to create the boss account.",
    "首次设置只能在店里的电脑上进行。请在那台电脑上打开 POS 程序来创建老板账号。",
    "Persediaan kali pertama hanya boleh dibuat pada komputer kedai itu sendiri. Buka aplikasi POS pada komputer itu untuk mencipta akaun bos.",
  ],
  [
    "Phone / tablet access is on, so this computer cannot be confirmed as the shop computer. Turn phone / tablet access off, then create the boss account.",
    "「手机 / 平板访问」已打开，无法确认这是店里的电脑。请先关闭手机 / 平板访问，再创建老板账号。",
    "Akses telefon / tablet sedang dihidupkan, jadi komputer ini tidak dapat disahkan sebagai komputer kedai. Matikan akses telefon / tablet, kemudian cipta akaun bos.",
  ],
  // Setup code on a dev / manual run (start.bat / npm run dev)
  [
    "Enter the setup code shown in the server window on the shop computer (the window opened by start.bat). It proves you are at the shop computer.",
    "请输入店里电脑上服务器窗口（start.bat 打开的窗口）显示的设置码，用来确认你就在店里的电脑前。",
    "Masukkan kod persediaan yang dipaparkan dalam tetingkap pelayan pada komputer kedai (tetingkap yang dibuka oleh start.bat). Ini membuktikan anda berada di komputer kedai.",
  ],
  [
    "That setup code is not right. Check the server window on the shop computer and try again.",
    "设置码不对。请查看店里电脑上的服务器窗口，再试一次。",
    "Kod persediaan itu tidak betul. Semak tetingkap pelayan pada komputer kedai dan cuba lagi.",
  ],
  ["Setup Code *", "设置码 *", "Kod Persediaan *"],
  ["Turn off phone / tablet access", "关闭手机 / 平板访问", "Matikan akses telefon / tablet"],
  ["Restarting...", "正在重新启动...", "Memulakan semula..."],
  [
    "You can turn it on again later in Settings → Phone / Tablet.",
    "以后可以在「设置 → 手机 / 平板」重新打开。",
    "Anda boleh menghidupkannya semula kemudian di Tetapan → Telefon / Tablet.",
  ],
  [
    "Username required and password at least 8 characters",
    "请输入用户名，密码至少 8 个字符",
    "Nama pengguna diperlukan dan kata laluan sekurang-kurangnya 8 aksara",
  ],
];
