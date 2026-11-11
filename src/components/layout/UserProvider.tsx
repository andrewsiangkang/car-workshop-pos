"use client";

import { createContext, useContext } from "react";

export type UiUser = { name: string; role: string };

const UserContext = createContext<UiUser>({ name: "", role: "STAFF" });

export function UserProvider({ user, children }: { user: UiUser; children: React.ReactNode }) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser() {
  const u = useContext(UserContext);
  return { ...u, isOwner: u.role === "OWNER" };
}
