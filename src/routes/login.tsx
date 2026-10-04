import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import {
  AUTH_EVENT,
  armPopupSignIn,
  clearPreviousSession,
  readAccountStatus,
  replayAccountPaint,
  type AuthEventDetail,
  type CachedAccount,
} from "@/lib/auth/session-bridge";
import { useAccountStatus, useCachedAccount } from "@/lib/use-account";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: Login,
});

const authEnabled = import.meta.env.VITE_AUTH_ENABLED !== "false";

function Login() {
  const { next } = Route.useSearch();
  const callbackURL = next || "/login";
  const [error, setError] = useState<string | null>(null);
  const status = useAccountStatus();
  const account = useCachedAccount();

  useLayoutEffect(() => {
    const current = readAccountStatus();
    if (current === "in") {
      replayAccountPaint();
      return;
    }
    if (current === "out") {
      const root = document.documentElement;
      delete root.dataset.account;
      root.style.removeProperty("--account-label");
      root.style.removeProperty("--account-initial");
      root.style.removeProperty("--account-email");
    }
  }, [status, account]);

  useEffect(() => {
    const onAuth = (event: Event) => {
      const detail = (event as CustomEvent<AuthEventDetail>).detail;
      if (!detail?.error) return;
      setError(detail.error);
    };
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, []);

  return (
    <AppShell solidHeader>
      <main className="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:py-24">
        <section className="login-out">
          <h1 className="font-display text-4xl tracking-tight">Sign in</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            History, saved reads, and settings live on your account. Generating a
            read does not require signing in.
          </p>

          <div className="mt-8 space-y-3">
            {authEnabled ? (
              GROK_PROVIDERS.map((provider) => {
                const href = `/auth/popup?providerId=${encodeURIComponent(provider.providerId)}`;
                return (
                  <a
                    key={provider.providerId}
                    href={href}
                    target="_blank"
                    rel="opener"
                    data-provider={provider.providerId}
                    data-base={href}
                    className={cn(buttonVariants({ variant: "secondary" }), "w-full")}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      stampProviderLink(event.currentTarget, "pointer");
                    }}
                    onClick={(event) => {
                      const nonce = stampProviderLink(event.currentTarget, "click");
                      armPopupSignIn({
                        callbackURL,
                        nonce,
                        clear: clearPreviousSession(),
                      });
                    }}
                  >
                    Continue with {provider.label}
                  </a>
                );
              })
            ) : (
              <p className="text-sm text-muted">Sign-in is disabled.</p>
            )}
          </div>
          {error ? <p className="mt-4 text-sm text-muted">{error}</p> : null}

          <p className="mt-8 text-sm text-faint">
            <Link to="/" className="text-muted underline-offset-4 hover:text-fg hover:underline">
              Back to ReadTube
            </Link>
          </p>
        </section>
        <AccountPanel account={account} />
      </main>
    </AppShell>
  );
}

function AccountPanel({ account }: { account: CachedAccount | null }) {
  const [signingOut, setSigningOut] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  useLayoutEffect(() => {
    setShowPhoto(true);
  }, []);
  const photo = showPhoto ? account?.profileImageUrl : null;

  return (
    <section className="login-in">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">Account</p>
      <h1 className="mt-2 font-display text-4xl tracking-tight">Your account</h1>
      <div className="mt-8 flex items-center gap-4 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
        {photo ? (
          <img
            src={photo}
            alt=""
            referrerPolicy="no-referrer"
            className="size-14 rounded-full object-cover"
          />
        ) : (
          <span
            data-account-initial
            suppressHydrationWarning
            className="grid size-14 place-items-center rounded-full bg-elevated font-display text-xl"
          />
        )}
        <div className="min-w-0">
          <p data-account-name suppressHydrationWarning className="truncate font-medium" />
          <p data-account-email suppressHydrationWarning className="truncate text-sm text-muted" />
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        <a href="/history" className={cn(buttonVariants({ variant: "secondary" }), "w-full")}>
          History
        </a>
        <a href="/settings" className={cn(buttonVariants({ variant: "secondary" }), "w-full")}>
          Settings
        </a>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void import("@/lib/auth/client")
              .then((mod) => mod.signOut("/login"))
              .catch(() => setSigningOut(false));
          }}
          className={cn(buttonVariants({ variant: "outline" }), "w-full")}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      <p className="mt-8 text-sm text-faint">
        <a href="/" className="text-muted underline-offset-4 hover:text-fg hover:underline">
          Back to ReadTube
        </a>
      </p>
    </section>
  );
}

/**
 * Point the anchor at a unique popup. Pointerdown always mints a new nonce;
 * the click that follows reuses it so the poll and the navigation match.
 * Never calls preventDefault or window.open.
 */
function stampProviderLink(anchor: HTMLAnchorElement, reason: "pointer" | "click"): string {
  const age = Date.now() - Number(anchor.dataset.nonceAt || 0);
  const reuse = reason === "click" && Boolean(anchor.dataset.nonce) && age < 1000;
  const nonce = reuse ? anchor.dataset.nonce! : newNonce();
  const base = anchor.dataset.base || anchor.getAttribute("href") || anchor.href;
  const url = new URL(base, window.location.href);
  url.searchParams.set("nonce", nonce);
  anchor.href = `${url.pathname}${url.search}`;
  anchor.target = "_blank";
  anchor.rel = "opener";
  anchor.dataset.nonce = nonce;
  anchor.dataset.nonceAt = String(Date.now());
  return nonce;
}

function newNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}
