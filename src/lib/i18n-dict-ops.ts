// v0.3.30 step-14 dictionary rows: [English, 中文, Bahasa Melayu]. See src/lib/i18n.ts.
// 【中文】第 14 步（运维）新增的界面文字：更新面板（下载后核对校验值再安装）。
export const ROWS: Array<[string, string, string]> = [
  // Settings → Version & updates (verified download and install)
  ["Could not check:", "无法检查：", "Tidak dapat menyemak:"],
  ["Download and install v", "下载并安装 v", "Muat turun dan pasang v"],
  ["Downloading and checking the installer…", "正在下载并核对安装程序…", "Sedang memuat turun dan menyemak pemasang…"],
  ["What's new", "更新内容", "Apa yang baharu"],
  [
    "The installer is downloaded and checked against the checksum published with the release before it runs. The app makes a final backup and closes first.",
    "安装程序下载后，会先和发布时附带的校验值核对，一致才会运行。程序会先做最后一次备份再关闭。",
    "Pemasang dimuat turun dan disemak dengan checksum yang diterbitkan bersama keluaran sebelum dijalankan. Aplikasi membuat sandaran terakhir dan ditutup dahulu.",
  ],
  [
    "This release has no checksum to check the installer against, so it cannot be installed from here. Contact support.",
    "这个版本没有可核对的校验值，不能在这里安装。请联系技术支持。",
    "Keluaran ini tiada checksum untuk menyemak pemasang, jadi ia tidak boleh dipasang dari sini. Hubungi sokongan.",
  ],
  [
    "This release has no checksum to check the installer against, so it was not installed.",
    "这个版本没有可核对的校验值，所以没有安装。",
    "Keluaran ini tiada checksum untuk menyemak pemasang, jadi ia tidak dipasang.",
  ],
  [
    "The downloaded installer did not match the published checksum. It was deleted and not installed.",
    "下载的安装程序和发布的校验值不一致，已删除，没有安装。",
    "Pemasang yang dimuat turun tidak sepadan dengan checksum yang diterbitkan. Ia telah dipadam dan tidak dipasang.",
  ],
  [
    "Updates can only be installed in the installed desktop app.",
    "只有安装好的桌面版才能安装更新。",
    "Kemas kini hanya boleh dipasang dalam aplikasi desktop yang telah dipasang.",
  ],
  [
    "The demo version does not install updates.",
    "演示版不会安装更新。",
    "Versi demo tidak memasang kemas kini.",
  ],
  [
    "The download failed. Check the internet connection and try again.",
    "下载失败，请检查网络后再试。",
    "Muat turun gagal. Semak sambungan internet dan cuba lagi.",
  ],
  [
    "The app will close and the installer will open.",
    "程序会关闭，然后打开安装程序。",
    "Aplikasi akan ditutup dan pemasang akan dibuka.",
  ],
];
