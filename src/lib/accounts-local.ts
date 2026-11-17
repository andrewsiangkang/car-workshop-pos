import crypto from "crypto";
import { getConfiguredAuthSecret } from "@/lib/session-token.mjs";
import { trustedPeerAddress } from "@/lib/privacy-peer";
import {
  classifyRequestOrigin,
  setupCodeFromBytes,
  setupCodeMatches,
  SETUP_CODE_LENGTH,
  type RequestOrigin,
} from "@/lib/accounts-core.mjs";

/**
 * Header the desktop app can add to its own requests to prove they come from the shop computer
 * while phone / tablet access is on (the server then also listens on the LAN, where Host and
 * X-Forwarded-For could be faked). Value: HMAC-SHA256(AUTH_SECRET, "workshop-desktop-v1") in hex.
 * Only the Electron main process and this server know AUTH_SECRET, and the header only travels
 * over 127.0.0.1, so LAN devices never see it.
 */
export const DESKTOP_PROOF_HEADER = "x-workshop-desktop";

// Never accepted without a real AUTH_SECRET: on a start.bat / `npm run dev` run the fallback
// secret is public (in the source), so anyone on the LAN could compute the proof.
// 【中文】校验桌面程序附加的证明头（用本机 AUTH_SECRET 计算）；没有配置 AUTH_SECRET 时一律不认（开发用密钥是公开的）。
function desktopProofMatches(sent: string | null): boolean {
  const secret = getConfiguredAuthSecret();
  if (!secret || !sent || sent.length !== 64) return false;
  try {
    const want = crypto.createHmac("sha256", secret).update("workshop-desktop-v1").digest("hex");
    return crypto.timingSafeEqual(Buffer.from(sent.toLowerCase()), Buffer.from(want));
  } catch {
    return false;
  }
}

/**
 * Where this request comes from: "desktop" (proven shop computer), "loopback" (looks local but
 * cannot be proven) or "remote". X-Forwarded-For is filled in by Next.js from the socket address
 * when the client did not send one; the socket address itself (privacy-peer.ts) must also be
 * this computer when it is known. Rules and tests: accounts-core.mjs.
 * Note: a reverse proxy on this computer that rewrites Host to 127.0.0.1 and does not add
 * X-Forwarded-For would make outside requests look local; the usual proxies add the header.
 * 【中文】判断请求是否来自这台电脑（桌面程序）。规则见 accounts-core.mjs。
 */
export function requestOrigin(request: Request): RequestOrigin {
  const h = request.headers;
  return classifyRequestOrigin({
    host: h.get("host"),
    forwardedFor: h.get("x-forwarded-for"),
    lanAccess: process.env.WORKSHOP_LAN_ACCESS,
    desktopProof: desktopProofMatches(h.get(DESKTOP_PROOF_HEADER)),
    // Socket address stamped by this server (not by the client); null when not known.
    peerAddress: trustedPeerAddress(request),
  });
}

// ===== One-time setup code (dev / manual runs only) =====
// Kept on globalThis so a dev-server hot reload does not change the code the boss is reading.
const holder = globalThis as typeof globalThis & { __workshopSetupCode?: string };

/**
 * The first-run setup code for this server run. Created the first time it is needed and printed
 * in the server window (start.bat / `npm run dev`), which only someone at the shop computer can
 * read. A restart makes a new code (printed again). Never sent to any browser.
 * 【中文】本次运行的一次性首次设置码：第一次需要时生成，并打印在服务器窗口（start.bat / npm run dev）里；
 * 只有坐在店里电脑前的人看得到。重启会换新的设置码。不会发送给任何浏览器。
 */
export function currentSetupCode(): string {
  if (!holder.__workshopSetupCode) {
    holder.__workshopSetupCode = setupCodeFromBytes(crypto.randomBytes(SETUP_CODE_LENGTH));
    const line = "=".repeat(64);
    console.log(
      [
        "",
        line,
        `  First-time setup code / 首次设置码 / Kod persediaan:  ${holder.__workshopSetupCode}`,
        "  Type this code on the setup page to create the boss account.",
        "  在设置页面输入这个设置码来创建老板账号。",
        line,
        "",
      ].join("\n")
    );
  }
  return holder.__workshopSetupCode;
}

/** True when `given` is this run's setup code. Always makes sure the code exists (and was printed). */
export function setupCodeAccepted(given: unknown): boolean {
  return setupCodeMatches(currentSetupCode(), given);
}

/** Setup is finished: the code is no longer needed. */
export function forgetSetupCode(): void {
  delete holder.__workshopSetupCode;
}
