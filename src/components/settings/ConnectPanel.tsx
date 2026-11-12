"use client";

import { useEffect, useState } from "react";

type Addr = { name: string; ip: string; url: string; kind: "lan" | "tailscale" | "other" };

function AddrCard({ a, copied, onCopy, first }: { a: Addr; copied: string; onCopy: (u: string) => void; first: boolean }) {
  return (
    <div className={`flex flex-wrap items-center gap-4 ${first ? "" : "mt-4 border-t border-slate-100 pt-4"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/qr?text=${encodeURIComponent(a.url)}`} alt="QR code" width={140} height={140} className="rounded-lg border border-slate-200" />
      <div>
        <div className="text-xs text-slate-400">{a.name}</div>
        <div className="select-all text-xl font-bold text-slate-900">{a.url}</div>
        <button type="button" onClick={() => onCopy(a.url)} className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          {copied === a.url ? "Copied ✓" : "Copy address"}
        </button>
      </div>
    </div>
  );
}

/** Addresses to open this POS from a phone / tablet: on the shop Wi-Fi, and from outside the shop (Tailscale). */
export function ConnectPanel() {
  const [addrs, setAddrs] = useState<Addr[] | null>(null);
  const [port, setPort] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/network")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setAddrs(d.addresses || []);
          setPort(String(d.port || ""));
        }
      })
      .catch(() => setError("Could not read the network address"));
  }, []);

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  const lan = (addrs || []).filter((a) => a.kind !== "tailscale");
  const remote = (addrs || []).filter((a) => a.kind === "tailscale");

  return (
    <div className="max-w-2xl space-y-4">
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-slate-900">Open on Phone / Tablet (Shop Wi-Fi)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Connect the phone or tablet to the same Wi-Fi as this computer, then type the address below into its browser, or scan the QR code.
        </p>
        {addrs && lan.length === 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No network address found. Check that this computer is connected to Wi-Fi or a network cable.
          </div>
        )}
        {lan.map((a, i) => (
          <AddrCard key={a.ip} a={a} copied={copied} onCopy={copy} first={i === 0} />
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-semibold text-slate-900">Use Outside the Shop (Remote Access)</h2>
        <p className="mb-4 text-sm text-slate-500">
          Open and manage work orders from anywhere. This uses Tailscale, a free private network: only your own devices can reach the POS, and nothing is exposed to the public internet.
        </p>

        {remote.length > 0 ? (
          <>
            <div className="mb-3 inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Tailscale detected on this computer</div>
            {remote.map((a, i) => (
              <AddrCard key={a.ip} a={a} copied={copied} onCopy={copy} first={i === 0} />
            ))}
            <p className="mt-3 text-sm text-slate-500">
              On your phone: open the Tailscale app, make sure it is connected, then open the address above in the browser. It stays the same every time.
            </p>
          </>
        ) : (
          <>
            <div className="mb-3 inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">Tailscale not detected on this computer</div>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
              <li>On this computer: install Tailscale (tailscale.com/download) and sign in.</li>
              <li>On your phone / tablet: install the Tailscale app and sign in with the same account.</li>
              <li>Reopen this page. The remote address will appear here{port ? ` (port ${port})` : ""}.</li>
              <li>Outside the shop, turn on Tailscale on the phone, then open that address in the browser.</li>
            </ol>
          </>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
        <div className="mb-2 font-medium text-slate-800">If the phone cannot open it</div>
        <ul className="list-disc space-y-1 pl-5">
          <li>This computer must stay on with the POS program open.</li>
          <li>On the shop Wi-Fi: the phone must be on the same Wi-Fi (not mobile data, not a guest network).</li>
          <li>When Windows asks to allow the program through the firewall, choose Allow on Private networks.</li>
          <li>The Wi-Fi address can change after the computer or router restarts. Ask your IT person to give this computer a fixed IP in the router. The Tailscale address does not change.</li>
        </ul>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <div className="mb-2 font-medium">Keep it safe</div>
        <ul className="list-disc space-y-1 pl-5">
          <li>Do not open the POS port on the router (port forwarding) and do not put it on a public tunnel. Use Tailscale only.</li>
          <li>Use a strong password for the boss and every staff account. Remove staff accounts of people who left.</li>
          <li>The POS holds sales, costs and customer details. Only sign in to Tailscale on devices you trust, and turn on a screen lock on your phone.</li>
          <li>You are logged out automatically after 5 minutes without activity.</li>
        </ul>
      </div>
    </div>
  );
}
