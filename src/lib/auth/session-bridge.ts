/**
 * Opener-side sign-in hand-off. No Better Auth import, so the landing page and
 * the Google button never wait on that library.
 *
 * The popup posts `{ source: "grok-auth-popup", token, user? }`. The account
 * is painted in the same turn, before any network await, and a short guard
 * stops an older `/get-session` from wiping that fresh login.
 */
import { PRE_SIGN_IN_CLEAR_TIMEOUT_MS, settleArmedPopupSignIn } from "../../../scripts/sign-in-plan.mjs";
import { runPreSignInSignOut } from "../../../scripts/sign-out-plan.mjs";

const BEARER_KEY = "grok-auth.bearer-token";
const ACCOUNT_KEY = "readtube.account";
const ACCOUNT_AT_KEY = "readtube.account-at";
export const AUTH_EVENT = "readtube-auth";
/** How long a just-finished login ignores a null `/get-session`. */
const FRESH_LOGIN_MS = 20_000;

/** A profile stored this recently must survive an older null `/get-session`. */
export function shouldKeepFreshAccount(accountAt: number, now: number, windowMs = FRESH_LOGIN_MS): boolean {
  return accountAt > 0 && now >= accountAt && now - accountAt < windowMs;
}

export type CachedAccount = {
  displayName: string | null;
  primaryEmail: string | null;
  profileImageUrl: string | null;
};

export type AccountStatus = "unknown" | "in" | "out";

export type AuthEventDetail = { error?: string };

type Arm = {
  callbackURL: string;
  clear: Promise<void>;
  nonce: string | null;
};

type SessionUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type PopupPayload = {
  source?: string;
  token?: string | null;
  error?: string;
  user?: SessionUser | null;
  nonce?: string;
};

const POPUP_CHANNEL = "readtube-auth-popup";
const PENDING_NONCE_KEY = "readtube.pending-nonce";

let installed = false;
let ownerDepth = 0;
let arm: Arm | null = null;
let handling = false;
let applied = false;
/** Bumped when a new token arrives so an older profile fetch cannot wipe it. */
let epoch = 0;
/** Bumped on a new attempt or a sign-out so an in-flight settle cannot write back. */
let armId = 0;
/** Null `/get-session` results before this timestamp must not sign the visitor out. */
let protectUntil = 0;
let checked: AccountStatus = "unknown";
let navigateFn: ((path: string) => void) | null = null;
let watchTimer = 0;
let watchNonce: string | null = null;

export function isLivePreview(): boolean {
  return typeof window !== "undefined" && window.location.hostname.endsWith(".grok-sandbox.com");
}

/**
 * Signed-in display before `/get-session` returns.
 * Preview sessions live only in the bearer token, so a preview with neither a
 * token nor a cached account is signed out — no need to wait on the network.
 * Deployed sessions can live in an HttpOnly cookie, so that case stays unknown
 * until the server answers.
 */
export function accountStatusFrom(input: {
  checked: AccountStatus;
  hasAccount: boolean;
  hasBearer: boolean;
  livePreview: boolean;
}): AccountStatus {
  // A profile still in storage is signed in. Sign-out removes it in the same
  // turn, so a leftover "out" from an older check must not hide that profile.
  if (input.hasAccount || input.hasBearer) return "in";
  if (input.checked !== "unknown") return input.checked;
  if (input.livePreview) return "out";
  return "unknown";
}

export type SessionOutcome = "user" | "none" | "error";

/** What to do with a `/get-session` result that may be older than the login on screen. */
export function sessionWriteDecision(input: {
  ticket: number;
  epoch: number;
  protectUntil: number;
  now: number;
  outcome: SessionOutcome;
}): "apply" | "clear" | "ignore" {
  if (input.ticket !== input.epoch) return "ignore";
  if (input.outcome === "error") return "ignore";
  if (input.outcome === "user") return "apply";
  if (input.now < input.protectUntil) return "ignore";
  return "clear";
}

/** While this is held, `signIn()` owns the popup message and the bridge stays quiet. */
export function claimPopupOwner(): () => void {
  ownerDepth += 1;
  return () => {
    ownerDepth = Math.max(0, ownerDepth - 1);
  };
}

export function popupSignInApplied(): boolean {
  return applied;
}

/** SPA navigation after sign-in. Registered by the header; a full reload is the fallback. */
export function setAuthNavigator(fn: ((path: string) => void) | null): void {
  navigateFn = fn;
}

/**
 * Record the clear that is already running and where to go afterwards.
 * Call this in the same turn as the click that opens the provider, after
 * the link's target is set. Must not itself open a window or update React state.
 */
export function armPopupSignIn(opts: {
  callbackURL: string;
  clear: Promise<void>;
  nonce?: string;
}): void {
  armId += 1;
  applied = false;
  handling = false;
  arm = {
    callbackURL: opts.callbackURL,
    clear: opts.clear.catch(() => undefined),
    nonce: opts.nonce ?? null,
  };
  if (opts.nonce) {
    rememberPendingNonce(opts.nonce);
    watchHandoff(opts.nonce);
  }
}

function stopWatching(): void {
  watchNonce = null;
  if (watchTimer) {
    window.clearTimeout(watchTimer);
    watchTimer = 0;
  }
}

/**
 * Pick up the session the moment any channel has it: postMessage,
 * BroadcastChannel, or the preview handoff poll. A first login on a shared
 * cookie jar is also noticed by /get-session, without storing a fake token.
 */
function acceptPopupPayload(data: PopupPayload): void {
  // signIn() in client.ts owns the message while it holds the popup.
  if (ownerDepth > 0) return;
  const token = data.token ?? null;
  const account = accountFromPopupUser(data.user);
  if (applied || handling) {
    upgradeAccount(account);
    return;
  }
  if (!token && !account) {
    if (!data.error) return;
    window.dispatchEvent(
      new CustomEvent<AuthEventDetail>(AUTH_EVENT, {
        detail: { error: data.error },
      }),
    );
    return;
  }
  // Cookie-only detection (no bearer yet). Paint now; don't invent a token.
  if (!token) {
    handling = true;
    clearPendingNonce();
    stopWatching();
    showPopupAccount(account);
    const job = arm;
    navigateWithinApp(sameOrigin(implicitCallback(job)));
    void syncAccountFromSession().finally(() => {
      handling = false;
    });
    return;
  }
  handling = true;
  const id = armId;
  const job = arm;
  void settleArmedPopupSignIn({
    token,
    error: data.error,
    account,
    showAccount: () => {
      if (id !== armId) return;
      showPopupAccount(account);
    },
    clearPrevious: () => job?.clear ?? Promise.resolve(),
    storeToken: (value) => {
      if (id !== armId) return;
      storeSessionToken(value);
    },
    refreshSession: () => {
      if (id !== armId) return Promise.resolve();
      return syncAccountFromSession();
    },
    navigate: (url) => {
      if (id !== armId) return;
      navigateWithinApp(url);
    },
    callbackURL: implicitCallback(job),
    currentURL: window.location.href,
  })
    .then(() => {
      if (id === armId) handling = false;
    })
    .catch((err: unknown) => {
      if (id !== armId) return;
      handling = false;
      applied = false;
      const message = err instanceof Error ? err.message : "Sign-in failed";
      window.dispatchEvent(new CustomEvent<AuthEventDetail>(AUTH_EVENT, { detail: { error: message } }));
    });
}

function hasProfile(account: CachedAccount | null): boolean {
  if (!account) return false;
  return Boolean(
    (account.displayName && account.displayName !== "Account") || account.primaryEmail || account.profileImageUrl,
  );
}

/** A second delivery often carries the name the first one didn't. Paint it. */
function upgradeAccount(account: CachedAccount | null): void {
  if (!hasProfile(account) || !account) return;
  const current = readCachedAccount();
  if (
    current?.displayName === account.displayName &&
    current?.primaryEmail === account.primaryEmail &&
    current?.profileImageUrl === account.profileImageUrl
  ) {
    return;
  }
  writeCachedAccount({
    displayName: account.displayName || current?.displayName || null,
    primaryEmail: account.primaryEmail || current?.primaryEmail || null,
    profileImageUrl: account.profileImageUrl || current?.profileImageUrl || null,
  });
}

function watchHandoff(nonce: string): void {
  stopWatching();
  watchNonce = nonce;
  const started = Date.now();
  let sawTokenAt = 0;
  const tick = async () => {
    if (watchNonce !== nonce) return;
    try {
      const res = await fetch(`/auth/popup?claim=${encodeURIComponent(nonce)}`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });
      if (watchNonce !== nonce) return;
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          token?: string | null;
          user?: SessionUser | null;
        } | null;
        if (data?.token) {
          acceptPopupPayload({
            source: "grok-auth-popup",
            token: data.token,
            user: data.user ?? null,
            nonce,
          });
          const named = Boolean(data.user?.name || data.user?.email || data.user?.image);
          if (!sawTokenAt) sawTokenAt = Date.now();
          // Keep polling briefly so a name that arrives after the token still paints.
          if (named || Date.now() - sawTokenAt > 4_000) {
            clearPendingNonce();
            if (watchNonce === nonce) stopWatching();
            return;
          }
        }
      }
    } catch {
      /* the next tick retries */
    }
    if (watchNonce !== nonce) return;
    // Do not stop because popup.closed is true. After the window reaches
    // Google, the browser reports it closed even while the person is still
    // choosing an account. Stopping here is why Sign in stayed on screen.
    if (Date.now() - started > 180_000) {
      clearPendingNonce();
      if (watchNonce === nonce) stopWatching();
      return;
    }
    watchTimer = window.setTimeout(() => void tick(), 200);
  };
  void tick();
}

function rememberPendingNonce(nonce: string): void {
  try {
    window.sessionStorage.setItem(PENDING_NONCE_KEY, JSON.stringify({ nonce, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearPendingNonce(): void {
  try {
    window.sessionStorage.removeItem(PENDING_NONCE_KEY);
  } catch {
    /* ignore */
  }
}

function readPendingNonce(): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_NONCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { nonce?: string; at?: number };
    if (!parsed?.nonce || typeof parsed.at !== "number") return null;
    if (Date.now() - parsed.at > 180_000) {
      clearPendingNonce();
      return null;
    }
    return parsed.nonce;
  } catch {
    return null;
  }
}

function resumePendingHandoff(): void {
  const nonce = readPendingNonce();
  if (!nonce || nonce === watchNonce) return;
  watchHandoff(nonce);
}

function sameOrigin(callbackURL: string): string {
  try {
    const here = new URL(window.location.href);
    const next = new URL(callbackURL, here);
    if (next.origin !== here.origin) return "/";
    return `${next.pathname}${next.search}${next.hash}` || "/";
  } catch {
    return "/";
  }
}

export function installAuthPopupBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  adoptFreshStamp();
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (ownerDepth > 0) return;
    const data = event.data as PopupPayload | null;
    if (!data || data.source !== "grok-auth-popup") return;
    acceptPopupPayload(data);
  });
  try {
    const channel = new BroadcastChannel(POPUP_CHANNEL);
    channel.onmessage = (event) => {
      const data = event.data as PopupPayload | null;
      if (!data || data.source !== "grok-auth-popup") return;
      acceptPopupPayload(data);
    };
  } catch {
    /* BroadcastChannel is optional; the poll and postMessage still run. */
  }
  window.addEventListener(AUTH_EVENT, () => {
    adoptFreshStamp();
  });
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== BEARER_KEY && event.key !== ACCOUNT_KEY) return;
    if (!event.newValue) {
      if (Date.now() < protectUntil || shouldKeepFreshAccount(readAccountStamp(), Date.now())) return;
      accountRaw = undefined;
      checked = "out";
      delete document.documentElement.dataset.account;
      document.documentElement.style.removeProperty("--account-label");
      document.documentElement.style.removeProperty("--account-initial");
      document.documentElement.style.removeProperty("--account-email");
      publish();
      return;
    }
    if (event.key === BEARER_KEY) {
      try {
        window.sessionStorage.setItem(BEARER_KEY, event.newValue);
      } catch {
        /* ignore */
      }
    }
    if (Date.now() >= protectUntil) protectFreshLogin();
    if (event.key === ACCOUNT_KEY) {
      accountRaw = undefined;
      const account = readCachedAccount();
      if (account) writeCachedAccount(account);
    }
    void syncAccountFromSession();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    resumePendingHandoff();
    void syncAccountFromSession();
  });
  resumePendingHandoff();
  void syncAccountFromSession();
}

function adoptFreshStamp(): void {
  const at = readAccountStamp();
  if (!shouldKeepFreshAccount(at, Date.now())) return;
  protectUntil = Math.max(protectUntil, at + FRESH_LOGIN_MS);
}

function readAccountStamp(): number {
  if (typeof window === "undefined") return 0;
  try {
    const at = Number(window.sessionStorage.getItem(ACCOUNT_AT_KEY) || 0);
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

export function hasStoredBearer(): boolean {
  return Boolean(readBearer());
}

/** Bearer for server functions. Does not load Better Auth. */
export function getStoredBearer(): string | null {
  return readBearer();
}

function readBearer(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const session = window.sessionStorage.getItem(BEARER_KEY);
    if (session) return session;
    const saved = window.localStorage.getItem(BEARER_KEY);
    if (!saved) return null;
    window.sessionStorage.setItem(BEARER_KEY, saved);
    return saved;
  } catch {
    return null;
  }
}

function writeBearer(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.sessionStorage.setItem(BEARER_KEY, token);
      window.localStorage.setItem(BEARER_KEY, token);
    } else {
      window.sessionStorage.removeItem(BEARER_KEY);
      window.localStorage.removeItem(BEARER_KEY);
    }
  } catch {
    /* storage unavailable */
  }
}

/** Remember the popup's session token. Does not load the auth client. */
export function storeSessionToken(token: string): void {
  protectFreshLogin();
  applied = true;
  writeBearer(token);
}

function protectFreshLogin(): void {
  epoch += 1;
  protectUntil = Date.now() + FRESH_LOGIN_MS;
}

/**
 * Drop the local session immediately. Bumps the epoch so a `/get-session`
 * that started before sign-out cannot write the account back.
 */
export function dropLocalSession(): void {
  epoch += 1;
  armId += 1;
  protectUntil = 0;
  applied = false;
  handling = false;
  arm = null;
  stopWatching();
  clearPendingNonce();
  writeBearer(null);
  writeCachedAccount(null);
}

/**
 * Drop a previous session without importing Better Auth.
 * In the preview this is instant when there is no bearer, so the first Google
 * sign-in is not stuck behind a sign-out request. A clear that finishes after
 * a newer token arrived does not wipe that token.
 */
export function clearPreviousSession(): Promise<void> {
  const started = epoch;
  const livePreview = isLivePreview();
  const bearer = hasStoredBearer();
  const hasAccount = Boolean(readCachedAccount());
  const dev = import.meta.env?.DEV === true;
  if (!bearer && !hasAccount && (livePreview || dev)) {
    return Promise.resolve();
  }
  return runPreSignInSignOut({
    livePreview,
    hasBearer: bearer,
    requestSignOut: () => {
      const headers = authHeaders();
      headers.set("content-type", "application/json");
      return fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers,
        body: "{}",
      }).then((res) => {
        if (!res.ok) throw new Error("sign-out failed");
      });
    },
    clearToken: () => {
      if (epoch !== started || Date.now() < protectUntil) return;
      writeBearer(null);
    },
    timeoutMs: PRE_SIGN_IN_CLEAR_TIMEOUT_MS,
  });
}

/**
 * Full-page Google/X redirect used outside the live preview.
 * Starts from the click — no auth-library download first.
 */
export async function startProviderRedirect(providerId: string, callbackURL: string): Promise<void> {
  await clearPreviousSession();
  const res = await fetch("/api/auth/sign-in/oauth2", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId,
      callbackURL,
      errorCallbackURL: callbackURL,
      disableRedirect: true,
    }),
  });
  const data = (await res.json().catch(() => null)) as { url?: string; message?: string } | null;
  if (!res.ok || !data?.url) {
    throw new Error(data?.message || "Could not start sign-in");
  }
  window.location.assign(data.url);
}

/** Load the signed-in profile and publish it. Safe to call more than once. */
export function syncAccountFromSession(): Promise<void> {
  const ticket = epoch;
  return pullAccount(ticket);
}

async function pullAccount(ticket: number): Promise<void> {
  const hadBearer = hasStoredBearer();
  let user = await requestSession();
  if (ticket !== epoch) return;
  // Drop a dead preview token and try the cookie session once.
  // Never do this inside the window that protects a login we just painted.
  if (user === null && hadBearer && Date.now() >= protectUntil) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (ticket !== epoch) return;
    user = await requestSession();
    if (ticket !== epoch) return;
    if (user === null) {
      writeBearer(null);
      user = await requestSession();
      if (ticket !== epoch) return;
    }
  }
  const decision = sessionWriteDecision({
    ticket,
    epoch,
    protectUntil,
    now: Date.now(),
    outcome: user === undefined ? "error" : user ? "user" : "none",
  });
  if (decision === "ignore") return;
  if (decision === "clear" || !user) {
    // The request started before this login. Do not erase the name it just painted.
    if (shouldKeepFreshAccount(readAccountStamp(), Date.now())) return;
    writeCachedAccount(null);
    return;
  }
  protectUntil = 0;
  writeCachedAccount({
    displayName: clean(user.name),
    primaryEmail: clean(user.email),
    profileImageUrl: clean(user.image),
  });
}

async function requestSession(): Promise<SessionUser | null | undefined> {
  try {
    const res = await fetch("/api/auth/get-session", {
      method: "GET",
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return undefined;
    const data = (await res.json().catch(() => null)) as { user?: SessionUser | null } | null;
    if (!data || !data.user) return null;
    return data.user;
  } catch {
    return undefined;
  }
}

function authHeaders(): Headers {
  const headers = new Headers();
  const token = readBearer();
  if (token) headers.set("authorization", `Bearer ${token}`);
  return headers;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function accountFromPopupUser(user: SessionUser | null | undefined): CachedAccount | null {
  if (!user) return null;
  const account = {
    displayName: clean(user.name),
    primaryEmail: clean(user.email),
    profileImageUrl: clean(user.image),
  };
  if (!account.displayName && !account.primaryEmail && !account.profileImageUrl) return null;
  return account;
}

/** Paint a login the moment the popup tells us who it is. No network. */
function showPopupAccount(account: CachedAccount | null): void {
  protectFreshLogin();
  applied = true;
  writeCachedAccount(
    account ?? {
      displayName: "Account",
      primaryEmail: null,
      profileImageUrl: null,
    },
  );
}

let accountRaw: string | null | undefined;
let accountSnapshot: CachedAccount | null = null;

export function readCachedAccount(): CachedAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNT_KEY);
    if (raw === accountRaw) return accountSnapshot;
    accountRaw = raw;
    if (!raw) {
      accountSnapshot = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<CachedAccount> | null;
    if (!parsed || typeof parsed !== "object") {
      accountSnapshot = null;
      return null;
    }
    accountSnapshot = {
      displayName: clean(parsed.displayName),
      primaryEmail: clean(parsed.primaryEmail),
      profileImageUrl: clean(parsed.profileImageUrl),
    };
    return accountSnapshot;
  } catch {
    return accountSnapshot;
  }
}

export function readAccountStatus(): AccountStatus {
  if (typeof window === "undefined") return "unknown";
  return accountStatusFrom({
    checked,
    hasAccount: Boolean(readCachedAccount()),
    hasBearer: hasStoredBearer(),
    livePreview: isLivePreview(),
  });
}

export function writeCachedAccount(account: CachedAccount | null): void {
  // A profile written while a /get-session is in flight must win. Bumping
  // the epoch makes that older empty response ignore itself.
  if (account) epoch += 1;
  checked = account ? "in" : "out";
  if (typeof window === "undefined") return;
  try {
    const next = account
      ? JSON.stringify({
          displayName: account.displayName,
          primaryEmail: account.primaryEmail,
          profileImageUrl: account.profileImageUrl,
        })
      : "";
    const prev = window.localStorage.getItem(ACCOUNT_KEY) ?? "";
    if (next !== prev) {
      if (!next) window.localStorage.removeItem(ACCOUNT_KEY);
      else window.localStorage.setItem(ACCOUNT_KEY, next);
      accountRaw = undefined;
    }
    if (account) {
      try {
        window.sessionStorage.setItem(ACCOUNT_AT_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
      document.documentElement.dataset.account = "in";
      paintAccountLabel(account);
    } else {
      try {
        window.sessionStorage.removeItem(ACCOUNT_AT_KEY);
      } catch {
        /* ignore */
      }
      delete document.documentElement.dataset.account;
      document.documentElement.style.removeProperty("--account-label");
      document.documentElement.style.removeProperty("--account-initial");
      document.documentElement.style.removeProperty("--account-email");
    }
  } catch {
    publish();
    return;
  }
  publish();
}

/** Put the cached name back on the document if hydration stripped it. */
export function replayAccountPaint(): void {
  const account = readCachedAccount();
  if (!account || typeof document === "undefined") return;
  document.documentElement.dataset.account = "in";
  paintAccountLabel(account);
}

function paintAccountLabel(account: CachedAccount): void {
  const label = account.displayName || account.primaryEmail || "Account";
  const root = document.documentElement;
  root.style.setProperty("--account-label", JSON.stringify(label));
  root.style.setProperty("--account-initial", JSON.stringify(label.charAt(0).toUpperCase()));
  root.style.setProperty("--account-email", JSON.stringify(account.primaryEmail || ""));
}

function publish(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

export function subscribeAccount(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(AUTH_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(AUTH_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function implicitCallback(job: Arm | null): string {
  if (job?.callbackURL) return job.callbackURL;
  const url = new URL(window.location.href);
  if (url.pathname === "/login") return url.searchParams.get("next") || "/";
  return url.href;
}

function navigateWithinApp(url: string): void {
  const here = new URL(window.location.href);
  let path = "/";
  try {
    const next = new URL(url, here);
    path = next.origin === here.origin ? `${next.pathname}${next.search}${next.hash}` || "/" : "/";
  } catch {
    path = "/";
  }
  const current = `${here.pathname}${here.search}${here.hash}`;
  if (current === path) return;
  try {
    if (navigateFn) {
      navigateFn(path);
      return;
    }
  } catch {
    /* fall through to a full navigation */
  }
  window.location.assign(path);
}
