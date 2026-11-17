// v0.3.29 translations added by the "desktop" fixes: [English, 中文, Bahasa Melayu].
// Kept in its own file so several changes can add rows without touching i18n-dict.ts.
export const ROWS: Array<[string, string, string]> = [
  // Settings → Backup: restore / password errors
  [
    "Only the boss can do this. Log in with the boss account and try again.",
    "只有老板可以执行此操作。请用老板账号登录后再试。",
    "Hanya bos boleh melakukan ini. Log masuk dengan akaun bos dan cuba lagi.",
  ],
  [
    "The app's server is not running. Close and reopen the app, then try again.",
    "程序的内部服务器没有运行。请关闭并重新打开程序后再试。",
    "Pelayan aplikasi tidak berjalan. Tutup dan buka semula aplikasi, kemudian cuba lagi.",
  ],
  ["A restore is already in progress.", "正在还原中，请稍候。", "Pemulihan sedang dijalankan."],
  ["Wrong backup password.", "备份密码错误。", "Kata laluan sandaran salah."],
  ["Enter the backup password.", "请输入备份密码。", "Masukkan kata laluan sandaran."],
  ["This file is not a Workshop POS backup.", "这个文件不是本 POS 的备份文件。", "Fail ini bukan sandaran Workshop POS."],
  [
    "This backup file is damaged or was changed. Nothing was changed.",
    "这个备份文件已损坏或被改动过。现有资料没有任何改变。",
    "Fail sandaran ini rosak atau telah diubah. Tiada apa-apa yang diubah.",
  ],
  [
    "This backup file is damaged or is not a Workshop POS database. Nothing was changed.",
    "这个备份文件已损坏，或不是本 POS 的数据库。现有资料没有任何改变。",
    "Fail sandaran ini rosak atau bukan pangkalan data Workshop POS. Tiada apa-apa yang diubah.",
  ],
  [
    "Could not save a safety copy of the current data, so nothing was changed. Check the free disk space and try again.",
    "无法保存当前资料的安全副本，所以没有进行还原。请检查硬盘剩余空间后再试。",
    "Salinan keselamatan data semasa tidak dapat disimpan, jadi tiada apa-apa yang diubah. Semak ruang cakera kosong dan cuba lagi.",
  ],
  [
    "That is the database the app is using now. Choose a backup file instead.",
    "这是程序正在使用的数据库，请选择一个备份文件。",
    "Itu pangkalan data yang sedang digunakan oleh aplikasi. Pilih fail sandaran.",
  ],
  ["The password must be at least 8 characters.", "密码至少需要 8 个字符。", "Kata laluan mesti sekurang-kurangnya 8 aksara."],
  ["The password is too long.", "密码太长。", "Kata laluan terlalu panjang."],
  [
    "Choose a folder on another drive (USB drive or cloud folder), not the app's own data folder.",
    "请选择另一个硬盘上的文件夹（USB 硬盘或云盘文件夹），不要选程序自己的数据文件夹。",
    "Pilih folder pada pemacu lain (pemacu USB atau folder awan), bukan folder data aplikasi sendiri.",
  ],
  [
    "Make an encrypted copy in this folder first, then delete the old unencrypted copies.",
    "请先在这个文件夹里成功保存一份加密副本，再删除旧的未加密副本。",
    "Buat salinan tersulit dalam folder ini dahulu, kemudian padam salinan lama yang tidak disulitkan.",
  ],
  ["Something went wrong. Nothing was changed.", "出现问题，资料没有任何改变。", "Berlaku masalah. Tiada apa-apa yang diubah."],
  ["The two passwords do not match.", "两次输入的密码不一致。", "Kedua-dua kata laluan tidak sepadan."],
  [
    "Backup password saved. Copies to the extra folder are encrypted with it.",
    "备份密码已保存。写到额外文件夹的副本会用它加密。",
    "Kata laluan sandaran disimpan. Salinan ke folder tambahan disulitkan dengannya.",
  ],
  ["Checking the backup file...", "正在检查备份文件...", "Menyemak fail sandaran..."],
  // Settings → Backup: status, retention, extra folder, password
  [
    "The last backup was a checked file copy (the server's snapshot was not available).",
    "上次备份是经过检查的文件复制（当时无法使用服务器快照）。",
    "Sandaran terakhir ialah salinan fail yang telah disemak (snapshot pelayan tidak tersedia).",
  ],
  [
    "The database was being changed during the backup, so this backup was not saved. Press Back up now to try again.",
    "备份时资料正在被修改，所以这次备份没有保存。请按「立即备份」再试一次。",
    "Pangkalan data sedang diubah semasa sandaran, jadi sandaran ini tidak disimpan. Tekan Sandar sekarang untuk cuba lagi.",
  ],
  [
    "Also always kept: one backup for each of the last 7 days, one for each of the last 12 months, and the newest safety copies made before a restore.",
    "另外一定保留：最近 7 天每天一份、最近 12 个月每月一份，以及最新的「还原前安全副本」。",
    "Juga sentiasa disimpan: satu sandaran bagi setiap 7 hari terakhir, satu bagi setiap 12 bulan terakhir, dan salinan keselamatan terbaharu yang dibuat sebelum pemulihan.",
  ],
  ["Backup password", "备份密码", "Kata laluan sandaran"],
  [
    "Copies in this folder are encrypted with your backup password (file names end in .db.enc).",
    "这个文件夹里的副本都用你的备份密码加密（文件名以 .db.enc 结尾）。",
    "Salinan dalam folder ini disulitkan dengan kata laluan sandaran anda (nama fail berakhir dengan .db.enc).",
  ],
  [
    "No backup password set: nothing is copied to this folder until you set one.",
    "还没有设置备份密码：设置之前不会往这个文件夹复制任何副本。",
    "Kata laluan sandaran belum ditetapkan: tiada apa-apa disalin ke folder ini sehingga anda menetapkannya.",
  ],
  [
    "Set a backup password first. Copies on a USB drive or cloud folder are encrypted with it.",
    "请先设置备份密码。USB 硬盘或云盘文件夹里的副本会用它加密。",
    "Tetapkan kata laluan sandaran dahulu. Salinan pada pemacu USB atau folder awan disulitkan dengannya.",
  ],
  ["New backup password", "新的备份密码", "Kata laluan sandaran baharu"],
  ["Type it again", "再输入一次", "Taip sekali lagi"],
  [
    "At least 8 characters. Write it down and keep it somewhere safe: without it nobody can open these copies, not even us.",
    "至少 8 个字符。请把密码写下来并妥善保管：没有它，谁都打不开这些副本（包括我们）。",
    "Sekurang-kurangnya 8 aksara. Catat dan simpan di tempat selamat: tanpanya tiada sesiapa boleh membuka salinan ini, termasuk kami.",
  ],
  [
    "Copies made before a password change still need the old password.",
    "更改密码之前做的副本仍然需要旧密码才能打开。",
    "Salinan yang dibuat sebelum kata laluan ditukar masih memerlukan kata laluan lama.",
  ],
  ["Save password", "保存密码", "Simpan kata laluan"],
  ["Change password", "更改密码", "Tukar kata laluan"],
  ["Remove password", "删除密码", "Buang kata laluan"],
  [
    "This folder still has unencrypted backup copies from an older version:",
    "这个文件夹里还有旧版本留下的未加密备份副本：",
    "Folder ini masih mempunyai salinan sandaran tidak disulitkan daripada versi lama:",
  ],
  ["Delete unencrypted copies", "删除未加密的副本", "Padam salinan tidak disulitkan"],
  ["Restore from a backup file…", "从备份文件还原…", "Pulihkan daripada fail sandaran…"],
  [
    "Restore a backup from this computer, a USB drive or a cloud folder (.db or encrypted .db.enc file). A safety copy of the current data is saved first.",
    "可从本机、USB 硬盘或云盘文件夹还原备份（.db 或加密的 .db.enc 文件）。还原前会先保存一份当前资料的安全副本。",
    "Pulihkan sandaran daripada komputer ini, pemacu USB atau folder awan (fail .db atau .db.enc tersulit). Salinan keselamatan data semasa disimpan dahulu.",
  ],
  [
    "This backup is encrypted. Enter the backup password to restore it:",
    "这个备份已加密。请输入备份密码进行还原：",
    "Sandaran ini disulitkan. Masukkan kata laluan sandaran untuk memulihkannya:",
  ],
  ["Safety copy before restore", "还原前的安全副本", "Salinan keselamatan sebelum pemulihan"],
  // Settings → e-Invoice / Backup
  [
    "The saved Client Secret cannot be opened on this computer (it is stored encrypted with this computer's key). Please type it in again and save.",
    "已保存的 Client Secret 在这台电脑上无法解开（它用本机的钥匙加密保存）。请重新输入并保存。",
    "Client Secret yang disimpan tidak dapat dibuka pada komputer ini (ia disimpan secara tersulit dengan kunci komputer ini). Sila taip semula dan simpan.",
  ],
  [
    "Unencrypted .db file with all customer data. Keep it safe and delete it when no longer needed. For USB / cloud copies use the encrypted extra copy above.",
    "未加密的 .db 文件，包含所有顾客资料。请妥善保管，不需要时删除。要放到 USB / 云盘，请使用上面的加密额外副本。",
    "Fail .db tidak disulitkan dengan semua data pelanggan. Simpan dengan selamat dan padam apabila tidak diperlukan. Untuk salinan USB / awan, gunakan salinan tambahan tersulit di atas.",
  ],
];
