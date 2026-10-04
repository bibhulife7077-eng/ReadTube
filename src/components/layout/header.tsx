import { Link, useRouter } from "@tanstack/react-router";
import { Clock3, Settings } from "lucide-react";
import { useLayoutEffect, useState } from "react";
import { Wordmark } from "@/components/logo";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { installAuthPopupBridge, replayAccountPaint, setAuthNavigator, type CachedAccount } from "@/lib/auth/session-bridge";
import { useAccountStatus, useCachedAccount } from "@/lib/use-account";
import { cn } from "@/lib/utils";

installAuthPopupBridge();

export function Header({
  className,
  solid = false,
  pinned = true,
}: {
  className?: string;
  solid?: boolean;
  pinned?: boolean;
}) {
  return (
    <header
      className={cn(
        "no-print z-40 border-b border-transparent",
        pinned ? "sticky top-0" : "relative",
        "pt-[env(safe-area-inset-top,0px)]",
        solid
          ? "border-border bg-bg/90 backdrop-blur-md"
          : "bg-gradient-to-b from-bg via-bg/80 to-transparent",
        className,
      )}
    >
      <AuthNavigator />
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <Wordmark />
        <nav className="flex items-center gap-0.5 sm:gap-1">
          <NavLink to="/history" icon={Clock3} label="History" />
          <NavLink to="/settings" icon={Settings} label="Settings" />
          <AuthSlot />
        </nav>
      </div>
    </header>
  );
}

function AuthNavigator() {
  const router = useRouter();
  useLayoutEffect(() => {
    replayAccountPaint();
    setAuthNavigator((path) => {
      router.history.push(path);
    });
    return () => setAuthNavigator(null);
  }, [router]);
  return null;
}

function NavLink({
  to,
  icon: Icon,
  label,
}: {
  to: "/history" | "/settings";
  icon: typeof Clock3;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex h-11 items-center gap-1.5 px-2.5 text-sm text-muted transition-colors hover:text-fg sm:px-3"
      preload="intent"
      activeProps={{ className: "text-fg" }}
    >
      <Icon className="size-4 sm:hidden" aria-hidden />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </Link>
  );
}

function AuthSlot() {
  const account = useCachedAccount();
  const status = useAccountStatus();
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    setSettled(true);
  }, []);
  // First paint matches the server HTML. The boot script already shows the
  // cached avatar, and this swap happens before the browser paints.
  if (settled && account && status !== "out") return <AccountMenu account={account} />;
  return (
    <div className="auth-slot relative flex h-11 min-w-[4.75rem] items-center justify-end">
      <div className="auth-known-out">
        <SignInLink />
      </div>
      <div className="auth-known-in items-center">
        <span className="inline-flex h-11 items-center gap-2 pr-2">
          <span
            data-account-initial
            suppressHydrationWarning
            className="grid size-8 place-items-center rounded-full bg-elevated text-sm font-medium"
          />
          <span
            data-account-name
            suppressHydrationWarning
            className="hidden max-w-36 truncate text-sm sm:inline"
          />
        </span>
      </div>
    </div>
  );
}

function SignInLink() {
  return (
    <div className="flex h-11 min-w-[4.75rem] items-center justify-end" data-auth-ready="out">
      <a href="/login" className="inline-flex h-11 items-center px-2.5 text-sm text-fg sm:px-3">
        Sign in
      </a>
    </div>
  );
}

function AccountMenu({ account }: { account: CachedAccount }) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const gateSession = hasGateSessionMarker();
  const label = account.displayName ?? account.primaryEmail ?? "Account";
  return (
    <div className="relative flex h-11 min-w-[4.75rem] items-center justify-end" data-auth-ready="in">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-11 items-center gap-2 rounded-full pr-2"
      >
        {account.profileImageUrl ? (
          <img
            src={account.profileImageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-8 rounded-full object-cover"
          />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-elevated text-sm font-medium">
            {label.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="hidden max-w-36 truncate text-sm sm:inline">{label}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-12 z-50 w-56 rounded-xl bg-elevated p-2 shadow-[var(--shadow-border)]"
        >
          <p className="px-2 pt-1 text-sm font-medium">{label}</p>
          {account.primaryEmail ? (
            <p className="px-2 pb-2 text-xs text-muted">{account.primaryEmail}</p>
          ) : (
            <div className="h-2" />
          )}
          {gateSession ? null : (
            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void import("@/lib/auth/client")
                  .then((mod) => mod.signOut("/"))
                  .catch(() => setSigningOut(false));
              }}
              className="flex h-11 w-full items-center rounded-lg px-2 text-left text-sm hover:bg-surface disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
