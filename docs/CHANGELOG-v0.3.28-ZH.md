# v0.3.28 — Security fixes (review items C1 + C2)

See `docs/CODE-REVIEW-v0.3.27.md` for the full review.

**Dependencies**
- Next.js 15.3.9 → 15.5.29 (and eslint-config-next). Fixes the critical "unauthenticated RCE on Windows-hosted servers", the image-optimiser RCEs, the middleware-bypass advisories and the Server Components DoS/SSRF advisories.
- `package-lock.json` regenerated: it was stale (next 15.3.2; electron, electron-builder and tesseract.js missing), so `npm ci` failed. `npm ci` now works.
- postcss inside Next forced to 8.5.32 and sharp to 0.35.5 (`overrides`); both were flagged high.
- Removed `zod` (never imported; flagged high).
- `images.unoptimized: true`: the app never used next/image, and this also turns off the `/_next/image` endpoint, which needed no login.
- `npm run lint` works again (config was written for eslint-config-next 16).
- Production `npm audit`: was 1 critical + 6 high, now 3 high, all in Prisma's CLI config loader (deepmerge-ts), which is not reachable at runtime. Fixing it needs Prisma 7.

**Phone / tablet access is now opt-in**
- The embedded server listens on `127.0.0.1` only. The boss turns phone / tablet access on in Settings → Phone / Tablet (desktop confirmation dialog; the internal server restarts).
- Existing shops see a one-time notice after updating.
- With access off, the customer e-Invoice request QR is not printed, and the invoice page explains why.

**Login checks**
- Middleware now verifies the session cookie's HMAC signature and expiry (Web Crypto) instead of only checking that a cookie exists. A forged cookie is rejected and deleted.
- Every dashboard server page now checks the login itself (`requirePageUser()` / `requirePageOwner()`), instead of relying on layout.tsx, which Next.js can skip during partial rendering.
- New tests: `tests/session-token.test.mjs` (valid / forged / expired / malformed cookies) and `tests/page-guards.test.mjs` (fails if a new server page has no login check).

---

**依赖**
- Next.js 升级到 15.5.29：修复“Windows 服务器免登录远程执行代码”等严重漏洞、图片优化器漏洞、绕过中间件漏洞。
- 重新生成 `package-lock.json`。以前的锁文件过期，`npm ci` 会失败，现在可以正常运行。
- postcss、sharp 升到已修复版本；删除没用到的 `zod`；关闭图片优化器（同时关闭免登录可访问的 `/_next/image`）。
- `npm run lint` 恢复正常。

**手机 / 平板访问改为默认关闭**
- 内置服务器只监听本机。老板在 设置 → Phone / Tablet 打开，电脑弹窗确认后自动重启内部服务器。
- 旧版本升级后会提示一次。
- 关闭时不打印顾客自助 e-Invoice 二维码。

**登录检查**
- 中间件会校验登录 cookie 的签名和有效期，伪造的 cookie 直接拒绝并删除。
- 每个后台页面自己检查登录（老板页面检查老板身份），不再只靠 layout。
- 新增登录凭证测试和页面守卫测试。
