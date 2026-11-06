"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { Rules } from "@/lib/rules";

const Ctx = createContext<Rules | null>(null);
export function RulesProvider({ rules, children }: { rules: Rules; children: ReactNode }) {
  return <Ctx.Provider value={rules}>{children}</Ctx.Provider>;
}
export function useRules(): Rules {
  const r = useContext(Ctx);
  if (!r) throw new Error("RulesProvider missing");
  return r;
}
