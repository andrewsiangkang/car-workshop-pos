import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionSignature } from "@/lib/session-token.mjs";

const COOKIE = SESSION_COOKIE;

// Only real static asset types skip the login redirect. (Previously ANY path
// containing a "." was treated as public.)
// 【中文】只有这些真正的静态文件类型不需要登录。
const STATIC_FILE = /\.(?:png|jpe?g|webp|gif|svg|ico|css|js|map|woff2?|ttf|txt)$/i;

// 【中文】安全响应头：禁止被嵌入别的网页、禁止猜测文件类型、内容安全策略（CSP）。
const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Next.js needs inline scripts/styles; blocks framing, plugins and foreign form posts.
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; " +
    `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}; ` +
    `connect-src 'self'${process.env.NODE_ENV === "production" ? "" : " ws:"};`  +
    " worker-src 'self' blob:; frame-ancestors 'none'; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'",
};

function withHeaders(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

/** CSRF defence: state-changing API calls must come from this app's own origin. */
// 【中文】防 CSRF：会修改数据的请求（POST/PUT/DELETE）必须来自本程序自己的网址。
function isCrossSite(request: NextRequest) {
  const m = request.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return false;
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host !== host;
    } catch {
      return true;
    }
  }
  // No Origin header: browsers always send one on cross-site POSTs, so allow
  // (same-origin form posts from older browsers / non-browser tools).
  return request.headers.get("sec-fetch-site") === "cross-site";
}

// Checks the session cookie's HMAC signature and expiry here (Web Crypto, no database),
// so a made-up "session" cookie no longer gets past this point. The database check
// (user still exists, password not reset) still happens in requireAuth / requirePageUser.
// 【中文】入口：校验登录 cookie 的签名和有效期，伪造的 cookie 直接跳转登录页（API 返回 401）。查数据库的完整验证仍在 requireAuth / requirePageUser。
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") && isCrossSite(request)) {
    return withHeaders(NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 }));
  }

  const token = request.cookies.get(COOKIE)?.value;
  const isPublic =
    pathname.startsWith("/login") ||
    pathname.startsWith("/setup") ||
    pathname.startsWith("/api/auth") ||
    // v0.2.9: customer e-Invoice request page opened from the QR code (no login; unguessable link)
    pathname.startsWith("/e-invoice/") ||
    pathname.startsWith("/api/public/") ||
    // desktop app → embedded server only; the route authenticates itself (HMAC of AUTH_SECRET +
    // loopback + no Origin), so scheduled / on-quit backups work after the idle logout.
    // 【中文】桌面程序内部备份接口：自身校验签名，不依赖登录状态。
    pathname === "/api/internal/backup" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    (STATIC_FILE.test(pathname) && !pathname.startsWith("/api/"));

  if (isPublic) return withHeaders(NextResponse.next());
  if (token && (await verifySessionSignature(token))) return withHeaders(NextResponse.next());

  let res: NextResponse;
  if (pathname.startsWith("/api/")) {
    res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("from", pathname);
    res = NextResponse.redirect(url);
  }
  // A forged or expired cookie is removed so the browser stops sending it.
  if (token) res.cookies.delete(COOKIE);
  return withHeaders(res);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
