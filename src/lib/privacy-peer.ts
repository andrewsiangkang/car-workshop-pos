/**
 * The real network address of the device that sent a request.
 *
 * Next.js fills X-Forwarded-For from the socket only when the client did not send one, so any
 * device on the shop Wi-Fi can type its own value. At server start (instrumentation.ts) we listen
 * to Node's "http.server.request.start" diagnostics channel, which runs before Next.js sees the
 * request, and write the socket address into PEER_HEADER, replacing anything a client sent.
 * 【中文】请求设备的真实网络地址：服务器启动时订阅 Node 的 http.server.request.start，在 Next.js 处理前
 * 把连接（socket）的地址写进 PEER_HEADER，覆盖客户端自己发来的同名请求头。X-Forwarded-For 可以被伪造，不再直接信任。
 */
export const PEER_HEADER = "x-workshop-peer";

type PeerHolder = typeof globalThis & { __workshopPeerStamp?: boolean; __workshopPeerHandler?: unknown };
const holder = globalThis as PeerHolder;

/** Starts stamping the socket address on every request (Node runtime only; called once at start). */
export async function installPeerStamp(): Promise<void> {
  if (holder.__workshopPeerStamp) return;
  const dc = await import("node:diagnostics_channel");
  const handler = (message: unknown) => {
    const m = message as {
      request?: { headers?: Record<string, unknown>; socket?: { remoteAddress?: string } };
      socket?: { remoteAddress?: string };
    };
    if (!m?.request?.headers) return;
    m.request.headers[PEER_HEADER] = m.socket?.remoteAddress || m.request.socket?.remoteAddress || "";
  };
  dc.subscribe("http.server.request.start", handler);
  // Keep a reference so the subscription is never garbage-collected.
  holder.__workshopPeerHandler = handler;
  holder.__workshopPeerStamp = true;
}

/**
 * Socket address of the request, or null when it is not known (the stamp is not installed,
 * e.g. in a test). A PEER_HEADER sent by a client is never trusted on its own: it is only read
 * when this server stamps (and so overwrites) it on every request.
 */
export function trustedPeerAddress(request: Request | null | undefined): string | null {
  if (!request || holder.__workshopPeerStamp !== true) return null;
  const v = request.headers.get(PEER_HEADER);
  return v ? v.trim() : null;
}
