// v0.3.30 step-14 dictionary rows: [English, 中文, Bahasa Melayu]. See src/lib/i18n.ts.
// e-Invoice lane: refund notes (type 04), sending to LHDN only once, consolidated range lines,
// buyer IDs / the optional TIN for individuals, and waiting buyer requests.
// 【中文】电子发票部分的翻译：退款通知（04）、只送 LHDN 一次、合并发票按号码分段、买方证件 / 个人可不填 TIN、等待中的顾客申请。
export const ROWS: Array<[string, string, string]> = [
  // Credit notes: LHDN document type (02 credit note / 04 refund note) and part refunds
  ["LHDN type: Credit note (02)", "LHDN 类型：贷项通知（02）", "Jenis LHDN: Nota kredit (02)"],
  ["LHDN type: Refund note (04)", "LHDN 类型：退款通知（04）", "Jenis LHDN: Nota bayaran balik (04)"],
  ["LHDN MyInvois sandbox (test) · Refund Note", "LHDN MyInvois 沙盒（测试）· 退款通知", "LHDN MyInvois sandbox (ujian) · Nota Bayaran Balik"],
  ["LHDN MyInvois e-Invoice (Refund Note)", "LHDN MyInvois 电子发票（退款通知）", "e-Invois LHDN MyInvois (Nota Bayaran Balik)"],
  ["Cannot be sent to LHDN: only part of it was refunded", "不能送 LHDN：只退了一部分钱", "Tidak boleh dihantar kepada LHDN: hanya sebahagian dibayar balik"],
  ["This credit note could not be sent to LHDN", "这张退款单将无法送 LHDN", "Nota kredit ini tidak akan dapat dihantar kepada LHDN"],
  [
    "This invoice is already reported to LHDN, so its credit notes must be sent too. LHDN has a credit note (no money back) and a refund note (all of it paid back), but no document for a part refund. Issue two credit notes instead: one for the amount you refund (refund it in full) and one for the rest with no refund.",
    "这张发票已经报给 LHDN，所以它的退款单也必须送 LHDN。LHDN 只有贷项通知（不退钱）和退款通知（全部退回），没有“只退一部分”的单据。请改开两张退款单：一张是要退的金额（全数退回），另一张是其余金额（不退钱）。",
    "Invois ini sudah dilaporkan kepada LHDN, jadi nota kreditnya juga mesti dihantar. LHDN ada nota kredit (tiada wang dipulangkan) dan nota bayaran balik (semuanya dibayar balik), tetapi tiada dokumen untuk bayaran balik separa. Keluarkan dua nota kredit: satu untuk jumlah yang anda bayar balik (bayar balik sepenuhnya) dan satu lagi untuk bakinya tanpa bayaran balik.",
  ],
  [
    "Only part of this credit note is refunded, so it cannot be sent to LHDN. Issue it anyway? It cannot be edited or deleted afterwards.",
    "这张退款单只退了一部分钱，所以不能送 LHDN。仍要开出吗？开出后不能修改或删除。",
    "Hanya sebahagian nota kredit ini dibayar balik, jadi ia tidak boleh dihantar kepada LHDN. Keluarkan juga? Ia tidak boleh diedit atau dipadam selepas itu.",
  ],
  [
    "Part of this credit note was refunded and part was not. LHDN has two document types for this: a credit note (value reduced, no money back) and a refund note (money returned), so one document cannot carry both. Nothing was sent. Issue the refunded part and the non-refunded part as two separate credit notes instead.",
    "这张退款单只退了一部分钱。LHDN 有两种单据：贷项通知（减少金额、不退钱）和退款通知（把钱退回），一份单据不能两样都有。没有送出任何资料。请把退钱的部分和不退钱的部分分开，各开一张退款单。",
    "Sebahagian nota kredit ini dibayar balik dan sebahagian tidak. LHDN ada dua jenis dokumen untuk ini: nota kredit (nilai dikurangkan, tiada wang dipulangkan) dan nota bayaran balik (wang dipulangkan), jadi satu dokumen tidak boleh membawa kedua-duanya. Tiada apa-apa dihantar. Keluarkan bahagian yang dibayar balik dan bahagian yang tidak dibayar balik sebagai dua nota kredit berasingan.",
  ],

  // Sending to LHDN only once (in flight / no answer)
  ["LHDN did not answer the last submission. Press Check Status.", "LHDN 没有回应上次的提交，请按「检查状态」。", "LHDN tidak menjawab penghantaran terakhir. Tekan Semak Status."],
  [
    "LHDN did not answer the last submission. Press Check Status before submitting again.",
    "LHDN 没有回应上次的提交。再提交之前，请先按「检查状态」。",
    "LHDN tidak menjawab penghantaran terakhir. Tekan Semak Status sebelum menghantar semula.",
  ],
  [
    "LHDN did not answer the last submission. It may still have arrived, so do not submit again yet: press Check Status.",
    "LHDN 没有回应上次的提交。单据可能其实已经送到，所以先不要再提交：请按「检查状态」。",
    "LHDN tidak menjawab penghantaran terakhir. Ia mungkin sudah sampai, jadi jangan hantar semula dahulu: tekan Semak Status.",
  ],
  ["Being sent to LHDN now. Wait a minute, then press Check Status.", "正在送 LHDN，请等一分钟再按「检查状态」。", "Sedang dihantar kepada LHDN. Tunggu seminit, kemudian tekan Semak Status."],
  [
    "This invoice is already being sent to LHDN (from another click or device). Wait a minute, then press Check Status.",
    "这张发票正在送 LHDN（另一次点击或另一台设备）。请等一分钟再按「检查状态」。",
    "Invois ini sedang dihantar kepada LHDN (daripada klik atau peranti lain). Tunggu seminit, kemudian tekan Semak Status.",
  ],
  [
    "This credit note is already being sent to LHDN (from another click or device). Wait a minute, then press Check Status.",
    "这张退款单正在送 LHDN（另一次点击或另一台设备）。请等一分钟再按「检查状态」。",
    "Nota kredit ini sedang dihantar kepada LHDN (daripada klik atau peranti lain). Tunggu seminit, kemudian tekan Semak Status.",
  ],
  [
    "The consolidated e-Invoice for this month is already being sent to LHDN (from another click or device). Wait a minute, then press Check Status.",
    "这个月的合并电子发票正在送 LHDN（另一次点击或另一台设备）。请等一分钟再按「检查状态」。",
    "e-Invois disatukan bagi bulan ini sedang dihantar kepada LHDN (daripada klik atau peranti lain). Tunggu seminit, kemudian tekan Semak Status.",
  ],
  [
    "This document is already being sent to LHDN (from another click or device). Wait until {time}, then press Check Status.",
    "这份单据正在送 LHDN（另一次点击或另一台设备）。请等到 {time} 再按「检查状态」。",
    "Dokumen ini sedang dihantar kepada LHDN (daripada klik atau peranti lain). Tunggu sehingga {time}, kemudian tekan Semak Status.",
  ],
  [
    "LHDN did not answer in time. The document may still have arrived, so it was NOT marked as failed. Press Check Status in a minute. Submitting again is only possible once LHDN confirms it does not have it (after {time}).",
    "LHDN 没有及时回应。单据可能其实已经送到，所以没有当作失败。请过一分钟按「检查状态」。要等 LHDN 确认没有收到（{time} 之后）才能重新提交。",
    "LHDN tidak menjawab tepat pada masanya. Dokumen mungkin sudah sampai, jadi ia TIDAK ditandakan gagal. Tekan Semak Status selepas seminit. Penghantaran semula hanya boleh dibuat setelah LHDN mengesahkan ia tidak menerimanya (selepas {time}).",
  ],
  [
    "The last submission got no answer from LHDN and LHDN does not show the document yet. To avoid a duplicate e-Invoice, wait until {time}, then press Check Status or submit again.",
    "上次提交 LHDN 没有回应，LHDN 也还查不到这份单据。为免重复开出电子发票，请等到 {time} 再按「检查状态」或重新提交。",
    "Penghantaran terakhir tidak dijawab oleh LHDN dan LHDN belum menunjukkan dokumen itu. Untuk mengelakkan e-Invois berganda, tunggu sehingga {time}, kemudian tekan Semak Status atau hantar semula.",
  ],
  [
    "LHDN already has this document from the earlier submission (UUID {uuid}, status {status}). It is now saved here; nothing new was sent.",
    "LHDN 已经有上次提交的这份单据（UUID {uuid}，状态 {status}），现已保存到这里，没有重新送出。",
    "LHDN sudah mempunyai dokumen ini daripada penghantaran sebelumnya (UUID {uuid}, status {status}). Ia kini disimpan di sini; tiada apa-apa yang baharu dihantar.",
  ],
  [
    "Could not check with LHDN whether the earlier submission arrived. Nothing was sent. Try again in a few minutes.",
    "无法向 LHDN 确认上次提交有没有送到，这次没有送出任何资料。请过几分钟再试。",
    "Tidak dapat menyemak dengan LHDN sama ada penghantaran sebelumnya sampai. Tiada apa-apa dihantar. Cuba lagi dalam beberapa minit.",
  ],
  [
    "LHDN does not show this document yet. Check again after {time}. Do not submit it again before then.",
    "LHDN 还查不到这份单据。请在 {time} 之后再查，在那之前不要重新提交。",
    "LHDN belum menunjukkan dokumen ini. Semak semula selepas {time}. Jangan hantar semula sebelum itu.",
  ],
  ["LHDN never received the earlier submission. You can submit it again.", "LHDN 没有收到上次的提交，可以重新提交。", "LHDN tidak pernah menerima penghantaran sebelumnya. Anda boleh menghantarnya semula."],
  ["Found at LHDN and saved.", "已在 LHDN 找到并保存。", "Dijumpai di LHDN dan disimpan."],
  [
    "The monthly consolidated e-Invoice that includes this invoice is being sent or waiting for LHDN's answer. Check its status on the e-Invoice page first.",
    "包含这张发票的每月合并电子发票正在送出或在等 LHDN 回应。请先到电子发票页面检查它的状态。",
    "e-Invois disatukan bulanan yang mengandungi invois ini sedang dihantar atau menunggu jawapan LHDN. Semak statusnya di halaman e-Invois dahulu.",
  ],
  [
    "A submission of the consolidated e-Invoice for {month} is running or waiting for LHDN's answer (since {time}). Press Check Status first.",
    "{month} 的合并电子发票正在提交或在等 LHDN 回应（从 {time} 开始）。请先按「检查状态」。",
    "Penghantaran e-Invois disatukan bagi {month} sedang berjalan atau menunggu jawapan LHDN (sejak {time}). Tekan Semak Status dahulu.",
  ],
  [
    "The invoices or credit notes for this month changed while the consolidated e-Invoice was being prepared. Nothing was sent. Reload the page, check the list and total, and submit again.",
    "准备合并电子发票期间，这个月的发票或退款单有变动，没有送出任何资料。请重新载入页面，核对清单和总额后再提交。",
    "Invois atau nota kredit bagi bulan ini berubah semasa e-Invois disatukan sedang disediakan. Tiada apa-apa dihantar. Muat semula halaman, semak senarai dan jumlah, kemudian hantar semula.",
  ],

  // Consolidated e-Invoice: range lines and the 300 KB limit
  [
    "LHDN accepts at most 300 KB per document. From about 300 invoices a month, the consolidated e-Invoice sent from here lists continuous ranges of invoice numbers (for example INV20261001001 - INV20261031045) instead of one line per invoice. The totals are the same to the sen.",
    "LHDN 每份单据最多 300 KB。一个月约 300 张发票以上时，从这里送出的合并电子发票会按连续的发票号码分段列出（例如 INV20261001001 - INV20261031045），而不是一张发票一行。总额精确到仙完全相同。",
    "LHDN menerima maksimum 300 KB bagi setiap dokumen. Mulai kira-kira 300 invois sebulan, e-Invois disatukan yang dihantar dari sini menyenaraikan julat nombor invois yang berturutan (contohnya INV20261001001 - INV20261031045) dan bukan satu baris bagi setiap invois. Jumlahnya sama hingga ke sen.",
  ],
  [
    "This month's consolidated e-Invoice would be about {kb} KB even with invoices grouped by number range, over LHDN's limit of 300 KB per document (too many breaks between ranges, e.g. many invoices e-Invoiced on their own). Nothing was sent. Contact support: the month has to be reported in more than one consolidated e-Invoice.",
    "即使按号码分段，这个月的合并电子发票也约有 {kb} KB，超过 LHDN 每份 300 KB 的上限（分段被打断太多次，例如很多发票单独开过电子发票）。没有送出任何资料。请联系技术支持：这个月需要分成多于一份合并电子发票申报。",
    "e-Invois disatukan bulan ini akan menjadi kira-kira {kb} KB walaupun invois dikumpulkan mengikut julat nombor, melebihi had LHDN 300 KB bagi setiap dokumen (terlalu banyak pemisahan antara julat, cth. banyak invois diberi e-Invois sendiri). Tiada apa-apa dihantar. Hubungi sokongan: bulan ini perlu dilaporkan dalam lebih daripada satu e-Invois disatukan.",
  ],

  // Buyer requests waiting for their own e-Invoice (review H4)
  [
    "Customers waiting for their own e-Invoice for more than {days} days: {count}",
    "等了超过 {days} 天仍未开出个别电子发票的顾客：{count}",
    "Pelanggan yang menunggu e-Invois sendiri lebih daripada {days} hari: {count}",
  ],
  [
    "These customers asked for their own e-Invoice (QR form or staff), but it has not been issued yet. Issue it from each invoice page before the deadline. After the deadline the sale is reported in the monthly consolidated e-Invoice as General Public instead.",
    "这些顾客要求了自己的电子发票（扫码或店员登记），但还没开出。请在截止日前到各发票页面开具。过了截止日，这笔交易会改以 General Public 并入每月合并电子发票。",
    "Pelanggan ini meminta e-Invois sendiri (borang QR atau kakitangan), tetapi ia belum dikeluarkan. Keluarkan dari setiap halaman invois sebelum tarikh akhir. Selepas tarikh akhir, jualan ini dilaporkan dalam e-Invois disatukan bulanan sebagai Orang Awam.",
  ],
  ["Asked on", "申请日期", "Diminta pada"],
  ["Issue by", "须在此日前开出", "Keluarkan sebelum"],

  // Buyer TIN / ID (TIN optional for a Malaysian individual with an IC)
  ["(LHDN general TIN for individuals)", "（LHDN 个人通用 TIN）", "(TIN am LHDN untuk individu)"],
  ["TIN (optional for IC)", "TIN（持身份证可不填）", "TIN (pilihan bagi IC)"],
  [
    "Most people do not know their TIN. For a Malaysian with an IC you may leave TIN blank: the e-Invoice then uses LHDN's general TIN for individuals (EI00000000010) with the IC number, as LHDN's guideline allows.",
    "多数人不知道自己的 TIN。持马来西亚身份证的个人可以不填 TIN：电子发票会按 LHDN 指南，使用个人通用 TIN（EI00000000010）加上身份证号码。",
    "Kebanyakan orang tidak tahu TIN mereka. Bagi warganegara Malaysia dengan IC, TIN boleh dibiarkan kosong: e-Invois akan menggunakan TIN am LHDN untuk individu (EI00000000010) bersama nombor IC, seperti yang dibenarkan dalam garis panduan LHDN.",
  ],
  [
    "A company (BRN), passport or army ID needs its TIN. Use Find TIN if the customer does not know it.",
    "公司（BRN）、护照或军人证必须有 TIN。顾客不知道的话，可以按「查找 TIN」查询。",
    "Syarikat (BRN), pasport atau ID tentera memerlukan TIN. Gunakan Cari TIN jika pelanggan tidak tahu.",
  ],
  [
    "The buyer has a TIN but no ID number (NRIC, BRN, passport or army ID). LHDN checks the TIN against it. Add the ID number in the buyer details on the invoice page, then try again.",
    "买方有 TIN 但没有证件号码（身份证、BRN、护照或军人证），LHDN 会用它核对 TIN。请在发票页面的买方资料里补上证件号码，然后再试。",
    "Pembeli ada TIN tetapi tiada nombor ID (NRIC, BRN, pasport atau ID tentera). LHDN menyemak TIN berdasarkannya. Tambah nombor ID dalam butiran pembeli di halaman invois, kemudian cuba lagi.",
  ],
  [
    "The buyer's {type} number (ending {last4}) is not valid for that ID type. Correct the ID type or ID number in the buyer details on the invoice page, then try again.",
    "买方的 {type} 号码（尾数 {last4}）不符合这个证件类型。请在发票页面的买方资料里改正证件类型或号码，然后再试。",
    "Nombor {type} pembeli (berakhir {last4}) tidak sah bagi jenis ID itu. Betulkan jenis ID atau nombor ID dalam butiran pembeli di halaman invois, kemudian cuba lagi.",
  ],
  [
    "A TIN is needed for a buyer identified by BRN, passport or army ID (only a Malaysian individual with an IC may leave it blank). Add the TIN in the buyer details on the invoice page, then try again.",
    "以 BRN、护照或军人证登记的买方必须有 TIN（只有持身份证的马来西亚个人可以不填）。请在发票页面的买方资料里填上 TIN，然后再试。",
    "TIN diperlukan bagi pembeli yang dikenal pasti dengan BRN, pasport atau ID tentera (hanya individu Malaysia dengan IC boleh membiarkannya kosong). Tambah TIN dalam butiran pembeli di halaman invois, kemudian cuba lagi.",
  ],
  ["Choose the ID type (NRIC, passport, BRN or army)", "请选择证件类型（身份证、护照、BRN 或军人证）", "Pilih jenis ID (NRIC, pasport, BRN atau tentera)"],
  [
    "The ID number is not valid for that ID type (NRIC: the 12 digits of a real IC; BRN: the SSM number, e.g. 202001012345)",
    "证件号码不符合证件类型（身份证：真实身份证上的 12 位数字；BRN：SSM 注册号，例如 202001012345）",
    "Nombor ID tidak sah bagi jenis ID itu (NRIC: 12 digit IC yang sebenar; BRN: nombor SSM, cth. 202001012345)",
  ],
  [
    "TIN is needed for a business, passport or army ID (only a Malaysian individual with an IC may leave it blank). It is 6 to 20 letters or numbers.",
    "公司、护照或军人证必须填 TIN（只有持身份证的马来西亚个人可以不填）。TIN 是 6 至 20 个字母或数字。",
    "TIN diperlukan bagi perniagaan, pasport atau ID tentera (hanya individu Malaysia dengan IC boleh membiarkannya kosong). Ia 6 hingga 20 huruf atau nombor.",
  ],
  ["NRIC must be the 12 digits of a real IC (no dashes)", "身份证号码必须是真实身份证上的 12 位数字（不要横线）", "NRIC mesti 12 digit IC yang sebenar (tanpa sengkang)"],
  ["BRN looks wrong (the SSM number, e.g. 202001012345)", "BRN 看起来不对（应是 SSM 注册号，例如 202001012345）", "BRN kelihatan salah (nombor SSM, cth. 202001012345)"],
  ["LHDN did not answer. Try again in a minute.", "LHDN 没有回应，请过一分钟再试。", "LHDN tidak menjawab. Cuba lagi selepas seminit."],
  [
    "Could not log in to LHDN MyInvois (no answer). Nothing was sent. Try again in a minute.",
    "无法登录 LHDN MyInvois（没有回应），没有送出任何资料。请过一分钟再试。",
    "Tidak dapat log masuk ke LHDN MyInvois (tiada jawapan). Tiada apa-apa dihantar. Cuba lagi selepas seminit.",
  ],

  // Fix round: one sale never reported twice (an invoice being sent on its own vs the monthly
  // consolidated e-Invoice), the lookup after an unanswered submission, and messages that were
  // still English only.
  [
    "These invoices have their own e-Invoice or a credit note being sent to LHDN or waiting for LHDN's answer: {invoices}. Open each one and press Check Status first, then try again.",
    "这些发票自己的电子发票或退款单正在送 LHDN，或在等 LHDN 回应：{invoices}。请逐一打开并先按「检查状态」，然后再试。",
    "Invois ini mempunyai e-Invois sendiri atau nota kredit yang sedang dihantar kepada LHDN atau menunggu jawapan LHDN: {invoices}. Buka setiap satu dan tekan Semak Status dahulu, kemudian cuba lagi.",
  ],
  ["Waiting for LHDN's answer on these invoices", "这些发票在等 LHDN 回应", "Menunggu jawapan LHDN bagi invois ini"],
  [
    "Their own e-Invoice (or a credit note) is being sent to LHDN or got no answer yet, so it may already be at LHDN. Open each one and press Check Status. The consolidated e-Invoice for this month can be sent once LHDN has answered, so no sale is reported twice.",
    "它们自己的电子发票（或退款单）正在送 LHDN 或还没得到回应，可能已经在 LHDN。请逐一打开并按「检查状态」。LHDN 回应后才能提交这个月的合并电子发票，以免同一笔交易申报两次。",
    "E-Invois sendiri (atau nota kredit) sedang dihantar kepada LHDN atau belum dijawab, jadi ia mungkin sudah berada di LHDN. Buka setiap satu dan tekan Semak Status. E-Invois disatukan bagi bulan ini boleh dihantar setelah LHDN menjawab, supaya tiada jualan dilaporkan dua kali.",
  ],
  [
    "LHDN lists too many documents around the time of the earlier submission of {number} to check them all here. Nothing was sent. Look for this document number in the MyInvois portal and contact support before submitting it again.",
    "在 {number} 上次提交的时间前后，LHDN 列出的单据太多，这里无法全部核对。没有送出任何资料。请先在 MyInvois 网站查找这个单号，并联系技术支持，然后才重新提交。",
    "LHDN menyenaraikan terlalu banyak dokumen sekitar masa penghantaran sebelumnya bagi {number} untuk disemak semuanya di sini. Tiada apa-apa dihantar. Cari nombor dokumen ini dalam portal MyInvois dan hubungi sokongan sebelum menghantarnya semula.",
  ],
  [
    "The buyer on this invoice has no valid ID number on record (NRIC, BRN, passport or army ID), and the invoice's e-Invoice is already at LHDN, so its buyer can no longer be changed here. Nothing was sent. Issue this credit note in the MyInvois portal instead, with the same buyer as the e-Invoice.",
    "这张发票的买方没有合格的证件号码（身份证、BRN、护照或军人证），而发票的电子发票已经在 LHDN，所以这里不能再修改买方。没有送出任何资料。请改在 MyInvois 网站开这张退款单，买方要和那张电子发票相同。",
    "Pembeli pada invois ini tiada nombor ID yang sah dalam rekod (NRIC, BRN, pasport atau ID tentera), dan e-Invois invois ini sudah berada di LHDN, jadi pembelinya tidak boleh diubah lagi di sini. Tiada apa-apa dihantar. Keluarkan nota kredit ini dalam portal MyInvois, dengan pembeli yang sama seperti e-Invois itu.",
  ],
  [
    "This invoice will be reported to LHDN on its own (the customer asked for their own e-Invoice, or has a TIN on file), so its credit notes must be sent too. LHDN has a credit note (no money back) and a refund note (all of it paid back), but no document for a part refund. Issue two credit notes instead: one for the amount you refund (refund it in full) and one for the rest with no refund.",
    "这张发票会单独报给 LHDN（顾客要求了自己的电子发票，或档案里有 TIN），所以它的退款单也必须送 LHDN。LHDN 只有贷项通知（不退钱）和退款通知（全部退回），没有“只退一部分”的单据。请改开两张退款单：一张是要退的金额（全数退回），另一张是其余金额（不退钱）。",
    "Invois ini akan dilaporkan kepada LHDN secara berasingan (pelanggan meminta e-Invois sendiri, atau ada TIN dalam rekod), jadi nota kreditnya juga mesti dihantar. LHDN ada nota kredit (tiada wang dipulangkan) dan nota bayaran balik (semuanya dibayar balik), tetapi tiada dokumen untuk bayaran balik separa. Keluarkan dua nota kredit: satu untuk jumlah yang anda bayar balik (bayar balik sepenuhnya) dan satu lagi untuk bakinya tanpa bayaran balik.",
  ],
  [
    "Only part refunded: cannot be sent to LHDN once the invoice has its own e-Invoice",
    "只退了一部分钱：发票单独开电子发票后，这张不能送 LHDN",
    "Hanya sebahagian dibayar balik: tidak boleh dihantar kepada LHDN setelah invois mempunyai e-Invois sendiri",
  ],
  [
    "This document was sent to the LHDN {recorded} system, but Settings are on {current}. Switch Settings to {target} to check it.",
    "这份单据是送到 LHDN {recorded} 系统的，但设置目前是 {current}。请把设置切换到 {target} 再检查。",
    "Dokumen ini dihantar ke sistem LHDN {recorded}, tetapi Tetapan ialah {current}. Tukar Tetapan kepada {target} untuk menyemaknya.",
  ],
  ["This record has no document number.", "这笔记录没有单号。", "Rekod ini tiada nombor dokumen."],
  ["Already submitted for {month} (UUID {uuid}).", "{month} 已经提交（UUID {uuid}）。", "Sudah dihantar bagi {month} (UUID {uuid})."],
  [
    "This invoice is being sent to LHDN or waiting for LHDN's answer. Press Check Status on the invoice page first.",
    "这张发票正在送 LHDN 或在等 LHDN 回应。请先在发票页面按「检查状态」。",
    "Invois ini sedang dihantar kepada LHDN atau menunggu jawapan LHDN. Tekan Semak Status di halaman invois dahulu.",
  ],
  // v0.3.30 fix round: buyer changed during a submit, portal consolidated records LHDN does not confirm
  [
    "The buyer details of this invoice were changed while it was being prepared. Nothing was sent. Check them and submit again.",
    "准备提交时这张发票的买方资料被改动了，没有送出任何东西。请检查后再提交。",
    "Butiran pembeli invois ini diubah semasa ia sedang disediakan. Tiada apa-apa dihantar. Semak butiran itu dan hantar semula.",
  ],
  [
    "LHDN has no document with UUID {uuid}. This record was set aside: record the consolidated e-Invoice again with the UUID and document number shown in the MyInvois portal.",
    "LHDN 没有 UUID 为 {uuid} 的单据。这笔记录已搁置：请用 MyInvois 网站上显示的 UUID 和单号重新登记合并电子发票。",
    "LHDN tiada dokumen dengan UUID {uuid}. Rekod ini diketepikan: rekod semula e-Invois disatukan dengan UUID dan nombor dokumen yang dipaparkan dalam portal MyInvois.",
  ],
  [
    "LHDN document {uuid} is for {other}, not {mine}. This record was set aside: record the consolidated e-Invoice again with the UUID and document number shown in the MyInvois portal.",
    "LHDN 单据 {uuid} 属于 {other}，不是 {mine}。这笔记录已搁置：请用 MyInvois 网站上显示的 UUID 和单号重新登记合并电子发票。",
    "Dokumen LHDN {uuid} adalah untuk {other}, bukan {mine}. Rekod ini diketepikan: rekod semula e-Invois disatukan dengan UUID dan nombor dokumen yang dipaparkan dalam portal MyInvois.",
  ],
  ["This record changed meanwhile. Reload the page.", "这笔记录刚刚有变动，请重新载入页面。", "Rekod ini berubah sementara itu. Muat semula halaman."],
  [
    "The LHDN environment in Settings changed while sending. Nothing was sent. Try again.",
    "送出时设置里的 LHDN 环境被改动了，没有送出任何东西。请再试一次。",
    "Persekitaran LHDN dalam Tetapan berubah semasa menghantar. Tiada apa-apa dihantar. Cuba lagi.",
  ],
  [
    "Production MyInvois submission is disabled until XAdES digital signing is implemented. Nothing was sent.",
    "在 XAdES 数字签名完成之前，不能从这里送正式 MyInvois。没有送出任何东西。",
    "Penghantaran MyInvois pengeluaran dilumpuhkan sehingga tandatangan digital XAdES dilaksanakan. Tiada apa-apa dihantar.",
  ],
  // v0.3.30 fix round 2: portal consolidated number as LHDN shows it, which document holds a UUID,
  // removing a reference typed in by mistake, an unanswered sandbox test while Settings are on production
  [
    "Document number looks wrong (type it as the MyInvois portal shows it, at most 50 characters)",
    "单号好像不对（请照 MyInvois 网站显示的输入，最多 50 个字符）",
    "Nombor dokumen nampaknya salah (taip seperti yang dipaparkan dalam portal MyInvois, maksimum 50 aksara)",
  ],
  ["Type it exactly as the MyInvois portal shows it.", "请照 MyInvois 网站显示的一字不差输入。", "Taip tepat seperti yang dipaparkan dalam portal MyInvois."],
  ["That UUID is already recorded on invoice {number}.", "这个 UUID 已经登记在发票 {number} 上。", "UUID itu sudah direkodkan pada invois {number}."],
  ["That UUID is already recorded on credit note {number}.", "这个 UUID 已经登记在退款单 {number} 上。", "UUID itu sudah direkodkan pada nota kredit {number}."],
  [
    "That UUID is already recorded on the consolidated e-Invoice for {month} ({number}).",
    "这个 UUID 已经登记在 {month} 的合并电子发票（{number}）上。",
    "UUID itu sudah direkodkan pada e-Invois disatukan untuk {month} ({number}).",
  ],
  [
    "That UUID is already recorded on the consolidated e-Invoice for {month} ({number}, set aside).",
    "这个 UUID 已经登记在 {month} 的合并电子发票（{number}，已搁置）上。",
    "UUID itu sudah direkodkan pada e-Invois disatukan untuk {month} ({number}, diketepikan).",
  ],
  [
    "LHDN shows this consolidated e-Invoice with document number {number}. The number recorded here ({old}) was corrected.",
    "LHDN 显示这份合并电子发票的单号是 {number}。这里登记的单号（{old}）已改正。",
    "LHDN memaparkan e-Invois disatukan ini dengan nombor dokumen {number}. Nombor yang direkodkan di sini ({old}) telah dibetulkan.",
  ],
  [
    "LHDN shows this consolidated e-Invoice as {number}, but another month's record already uses that number. Nothing was changed.",
    "LHDN 显示这份合并电子发票是 {number}，但另一个月份的记录已经用了这个单号。没有做任何改动。",
    "LHDN memaparkan e-Invois disatukan ini sebagai {number}, tetapi rekod bulan lain sudah menggunakan nombor itu. Tiada apa-apa diubah.",
  ],
  ["Only the boss can remove an e-Invoice reference", "只有老板可以移除电子发票编号", "Hanya bos boleh membuang rujukan e-Invois"],
  ["This invoice has no e-Invoice reference.", "这张发票没有电子发票编号。", "Invois ini tiada rujukan e-Invois."],
  [
    "This reference came from a submission by this app, not typed in by hand. Press Check Status to see what LHDN has.",
    "这个编号来自本程序的提交，不是手动填写的。请按「检查状态」看 LHDN 的记录。",
    "Rujukan ini datang daripada penghantaran oleh aplikasi ini, bukan ditaip secara manual. Tekan Semak Status untuk melihat rekod LHDN.",
  ],
  [
    "Remove this e-Invoice reference from the invoice? Only do this if it was typed in by mistake: the invoice then counts as not reported to LHDN and goes into the monthly consolidated e-Invoice.",
    "要从这张发票移除这个电子发票编号吗？只有填错时才这样做：之后这张发票算作还没向 LHDN 申报，会并入每月合并电子发票。",
    "Buang rujukan e-Invois ini daripada invois? Lakukan ini hanya jika ia ditaip secara silap: invois itu kemudian dikira sebagai belum dilaporkan kepada LHDN dan akan dimasukkan ke dalam e-Invois disatukan bulanan.",
  ],
  ["Reference removed.", "编号已移除。", "Rujukan telah dibuang."],
  ["Remove reference", "移除编号", "Buang rujukan"],
  [
    "An earlier SANDBOX test submission got no answer from LHDN. It is not a real e-Invoice and does not lock this invoice. It can only be checked with Settings on Sandbox.",
    "之前一次沙盒（测试）提交没有收到 LHDN 回应。它不是真正的电子发票，不会锁住这张发票。只有把设置切换到沙盒才能检查它。",
    "Satu penghantaran ujian SANDBOX sebelum ini tidak mendapat jawapan daripada LHDN. Ia bukan e-Invois sebenar dan tidak mengunci invois ini. Ia hanya boleh disemak dengan Tetapan pada Sandbox.",
  ],
];
