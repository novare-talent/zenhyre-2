"use client";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

const Ctx = createContext<(text: string) => void>(() => {});
export const useNotify = () => useContext(Ctx);

/** In-app notifications (§11): a polite live region, newest last, each gone after a few seconds. */
export function Toasts({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const n = useRef(0);
  const notify = useCallback((text: string) => {
    const id = ++n.current;
    setItems((xs) => [...xs.slice(-2), { id, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5200);
  }, []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className="toast">{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}
