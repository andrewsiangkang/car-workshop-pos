"use client";

import { createContext, useContext } from "react";

// id: used to keep per-user browser data apart (e.g. the new work order draft). 【中文】id 用来分开每个用户的浏览器草稿。
export type UiUser = { id: string; name: string; role: string };

const UserContext = createContext<UiUser>({ id: "", name: "", role: "STAFF" });

export function UserProvider({ user, children }: { user: UiUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser() {
  const u = useContext(UserContext);
  return { ...u, isOwner: u.role === "OWNER" };
}
