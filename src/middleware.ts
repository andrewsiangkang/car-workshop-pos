import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "session";

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

// Edge-compatible: only check cookie presence here.
// Full HMAC + DB verification happens in the Node runtime (API / server components).
// 【中文】入口：没有登录 cookie 就跳转登录页（API 返回 401）。这里只看 cookie 是否存在，真正的验证在服务器端 requireAuth。
export function middleware(request: NextRequest) {
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
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    (STATIC_FILE.test(pathname) && !pathname.startsWith("/api/"));

  if (isPublic || token) return withHeaders(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    return withHeaders(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return withHeaders(NextResponse.redirect(url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
