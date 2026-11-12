import os from "node:os";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Addr = { name: string; ip: string; url: string; kind: "lan" | "tailscale" | "other" };

/** Tailscale gives every device an address in 100.64.0.0 - 100.127.255.255. */
function isTailscale(ip: string) {
  const m = /^100\.(\d+)\./.exec(ip);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/** Home / shop networks first: 192.168.x.x, then 10.x.x.x, then 172.16-31.x.x, then anything else. */
function rank(ip: string) {
  if (ip.startsWith("192.168.")) return 0;
  if (isTailscale(ip)) return 4;
  if (ip.startsWith("10.")) return 1;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 2;
  return 3;
}

/**
 * The addresses a phone or tablet on the same Wi-Fi can use to open this POS.
 * The port is taken from the address this page was opened with.
 */
export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const host = request.headers.get("host") || "";
  const m = /:(\d+)$/.exec(host);
  const port = m ? m[1] : process.env.PORT || "3000";

  const found: Addr[] = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family !== "IPv4" || n.internal || n.address.startsWith("169.254.")) continue;
      const kind: Addr["kind"] = isTailscale(n.address) ? "tailscale" : rank(n.address) < 3 ? "lan" : "other";
      found.push({ name, ip: n.address, url: `http://${n.address}:${port}`, kind });
    }
  }
  found.sort((a, b) => rank(a.ip) - rank(b.ip));
  return NextResponse.json({ port, addresses: found });
}
