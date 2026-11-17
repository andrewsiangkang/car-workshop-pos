# Third-party notices

Workshop POS (修车店 POS) for Windows includes the open-source components listed below.
Each component remains under its own licence; this file is installed next to the program
(`resources/THIRD-PARTY-NOTICES.md` in the installation folder).

Versions are the ones this release was built with (`package.json` / `package-lock.json`).
The full licence texts, with their copyright lines, of every bundled package (also the smaller
ones not named below) are in the `resources/licenses/` folder of the installation:
`licenses/README.md` lists each package, its version and its file. The GNU LGPL v3 and GNU GPL v3
texts are `licenses/LGPL-3.0.txt` and `licenses/GPL-3.0.txt`. (Maintainers: the folder is made by
`node scripts/collect-licenses.mjs`; run it again after changing dependencies.)

## Runtime and framework

| Component | Licence | Notes |
|---|---|---|
| Electron 45 | MIT | Includes Chromium (BSD-3-Clause and others) and Node.js (MIT). Their notices are installed as `LICENSE.electron.txt` and `LICENSES.chromium.html` in the installation folder. https://github.com/electron/electron |
| Next.js 15.5 | MIT | https://github.com/vercel/next.js — with its bundled helpers styled-jsx (MIT), @swc/helpers (Apache-2.0) and caniuse-lite (CC-BY-4.0). |
| React / React DOM 19 | MIT | https://github.com/facebook/react (with scheduler, MIT) |
| Prisma Client 6 (incl. the query engine) | Apache-2.0 | https://github.com/prisma/prisma |
| Tailwind CSS 4 (generated stylesheet) | MIT | https://github.com/tailwindlabs/tailwindcss |

## Libraries

| Component | Licence | Notes |
|---|---|---|
| sharp | Apache-2.0 | https://github.com/lovell/sharp (with detect-libc, Apache-2.0; semver, ISC; @img/colour, MIT) |
| libvips 8.18.7 and its bundled libraries (inside `@img/sharp-win32-x64`) | LGPL-3.0-or-later (libvips); see below | Image processing library used by sharp. See the LGPL notice below and `licenses/libvips.md`. |
| tesseract.js / tesseract.js-core | Apache-2.0 | Offline text recognition for scanned supplier invoices. https://github.com/naptha/tesseract.js |
| English trained data (`eng.traineddata`, from tessdata_best) | Apache-2.0 | Packaged by `@tesseract.js-data/eng` (MIT). https://github.com/tesseract-ocr/tessdata_best |
| qrcode | MIT | https://github.com/soldair/node-qrcode |
| bcryptjs | BSD-3-Clause | https://github.com/dcodeIO/bcrypt.js |
| lucide-react | ISC | https://github.com/lucide-icons/lucide |
| date-fns | MIT | https://github.com/date-fns/date-fns |
| clsx | MIT | https://github.com/lukeed/clsx |
| tailwind-merge | MIT | https://github.com/dcastil/tailwind-merge |

## GNU LGPL notice for libvips

This program uses **libvips 8.18.7** (https://www.libvips.org/), prebuilt by the sharp-libvips
project for sharp 0.35.5. libvips is licensed under the GNU Lesser General Public License,
version 3 or (at your option) any later version. The prebuilt libvips also contains other
libraries under the LGPL-3.0 (glib, pango, fribidi, libexif, libheif, librsvg, proxy-libintl)
and under permissive licences (MIT, BSD, zlib, libpng, IJG, MPL-1.1 for cairo, and others);
`resources/licenses/libvips.md` lists each library with its version and licence.

- libvips is used as a separate shared library (DLL) loaded by sharp at run time. It is
  not modified and is not linked into the Workshop POS program code.
- You may replace the libvips DLLs (`libvips*.dll`) in
  `resources/app-server/node_modules/@img/sharp-win32-x64/lib/` with your own
  compatible build of the same libvips version.
- Source code:
  - libvips: https://github.com/libvips/libvips (release tag `v8.18.7`)
  - the exact build scripts and the sources of the bundled libraries:
    https://github.com/lovell/sharp-libvips
  - If you cannot download them, contact the supplier of this program for a copy of the
    corresponding source.
- Licence texts (included): `resources/licenses/LGPL-3.0.txt` (GNU LGPL v3) and
  `resources/licenses/GPL-3.0.txt` (GNU GPL v3, which the LGPL v3 builds on). Also online at
  https://www.gnu.org/licenses/lgpl-3.0.txt and https://www.gnu.org/licenses/gpl-3.0.txt.

No component under the GPL (other than as incorporated by the LGPL) or the AGPL is included.
