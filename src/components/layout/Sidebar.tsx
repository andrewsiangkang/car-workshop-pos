"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Wrench,
  Users,
  Car,
  Package,
  BarChart3,
  Settings,
  Menu,
  X,
  LogOut,
  FileStack,
  Truck,
  ReceiptText,
  Banknote,
  ClipboardList,
  BellRing,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/layout/UserProvider";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, ownerOnly: false },
  { href: "/work-orders", label: "Work Orders", icon: Wrench, ownerOnly: false },
  { href: "/counter", label: "Counter", icon: Banknote, ownerOnly: false },
  { href: "/customers", label: "Customers", icon: Users, ownerOnly: false },
  { href: "/vehicles", label: "Vehicles", icon: Car, ownerOnly: false },
  { href: "/service-reminders", label: "Service Reminders", icon: BellRing, ownerOnly: false },
  { href: "/inventory", label: "Inventory", icon: Package, ownerOnly: false },
  { href: "/supplier-invoices", label: "Supplier Invoices", icon: Truck, ownerOnly: true },
  { href: "/suppliers", label: "Suppliers", icon: Users, ownerOnly: true },
  { href: "/payment-vouchers", label: "Payment Vouchers", icon: ReceiptText, ownerOnly: true },
  { href: "/reports", label: "Business Intelligence", icon: BarChart3, ownerOnly: true },
  { href: "/audit-logs", label: "Audit Trail", icon: ClipboardList, ownerOnly: true },
  { href: "/einvoice", label: "e-Invoice (Monthly)", icon: FileStack, ownerOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, ownerOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { name, isOwner } = useUser();
  const visibleNav = navItems.filter((i) => isOwner || !i.ownerOnly);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-white">
            <Wrench className="h-4 w-4" />
          </div>
          <span className="font-semibold text-slate-900">Workshop POS</span>
        </div>
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-slate-100">
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen w-64 border-r border-slate-200 bg-white transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between border-b border-slate-200 px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-700 text-white">
                <Wrench className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">Workshop POS</div>
                <div className="text-xs text-slate-500">Workshop System</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="rounded p-1 md:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-4">
            {visibleNav.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-200 p-4 space-y-2">
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <LogOut className="h-5 w-5" />
              Logout
            </button>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              <div className="mb-1 font-medium text-slate-700">
                {name || "User"} · {isOwner ? "Boss" : "Staff"}
              </div>
              Local · Data stored on this computer
              <div className="mt-1 text-slate-400">v0.3.21</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
