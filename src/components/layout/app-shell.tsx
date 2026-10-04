import type { ReactNode } from "react";
import { Header } from "./header";

export function AppShell({
  children,
  solidHeader = false,
  lockViewport = false,
}: {
  children: ReactNode;
  solidHeader?: boolean;
  lockViewport?: boolean;
}) {
  if (lockViewport) {
    return (
      <div className="app-lock flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg text-fg">
        {children}
      </div>
    );
  }
  return (
    <div className="app-frame flex h-dvh max-h-dvh flex-col overflow-hidden bg-bg text-fg">
      <Header solid={solidHeader} pinned={false} />
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
        {children}
      </div>
    </div>
  );
}
