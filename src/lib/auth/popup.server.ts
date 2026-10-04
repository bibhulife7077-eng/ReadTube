/**
 * Live-preview sign-in popup — server-only (NEVER import from the client).
 *
 * The sandbox preview runs the app in a partitioned iframe, so OAuth must happen
 * in a top-level popup (first-party cookies). This handler is the ENTIRE popup
 * document — no React shell:
 *
 *   Phase 1 (`?providerId=…`): start OAuth server-side and 302 straight to the
 *     broker / upstream login page. The popup never paints the app.
 *   Phase 2 (`?done=1`): after the broker round-trip, emit a tiny HTML page that
 *     posts the session token to the opener and closes. No SPA hydrate, no
 *     server-fn round-trip.
 *
 * Wired automatically by the Vite `authPopupPlugin` in `vite.config.ts` during
 * `npm run dev` (live preview). Do NOT create `src/routes/auth/popup.tsx` — a
 * React route here paints the full app shell in the popup. The opener lives in
 * `client.ts` (`signIn` → `openSignInPopup`).
 */
import { auth, authCallbackOrigin, SESSION_TOKEN_COOKIE } from "./server";
import { savePopupHandoff, readPopupHandoff, rememberPopupUser, userFromSessionDataCookie, type HandoffUser } from "../server/popup-handoff";

/** Message shape the popup posts to the opener (must match the session bridge). */
type PopupUser = {
  name: string | null;
  email: string | null;
  image: string | null;
};

type PopupMessage = {
  source: "grok-auth-popup";
  token: string | null;
  error?: string;
  user?: PopupUser | null;
  nonce?: string;
};

/**
 * Handle `GET /auth/popup`. Invoked by the Vite `authPopupPlugin` (dev / live
 * preview). Do not re-export this from a React route file.
 */
export async function handleAuthPopupRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST") return storeHandoff(request);
  const claim = url.searchParams.get("claim");
  if (claim) return claimHandoff(claim);

  const nonce = safeNonce(url.searchParams.get("nonce"));
  const done = url.searchParams.get("done") === "1";

  if (done) {
    const errored = url.searchParams.has("error");
    const token = errored ? null : readSessionToken(request);
    // Store the token before any profile lookup. The opener is already polling;
    // waiting here is why the header stayed on Sign in after Google returned.
    const cachedUser = token ? userFromSessionDataCookie(request.headers.get("cookie")) : null;
    if (nonce && token) savePopupHandoff({ nonce, token, user: cachedUser });
    const user = cachedUser ?? (token ? await readPopupUser(request) : null);
    if (nonce && token && user && !cachedUser) rememberPopupUser(nonce, user);
    const message: PopupMessage = {
      source: "grok-auth-popup",
      token,
      ...(nonce ? { nonce } : {}),
      ...(user ? { user } : {}),
      ...(errored ? { error: url.searchParams.get("error") ?? "sign_in_failed" } : {}),
    };
    return new Response(completionHtml(message), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const providerId = url.searchParams.get("providerId")?.trim();
  if (!providerId) {
    return new Response("Missing providerId", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Stay first-party for the callback so the session cookie lands in THIS popup.
  // On Vercel this is the deployed domain, not an internal function host.
  const back = new URL("/auth/popup", authCallbackOrigin(url.origin));
  back.searchParams.set("done", "1");
  if (nonce) back.searchParams.set("nonce", nonce);
  const errorBack = new URL(back);
  errorBack.searchParams.set("error", "1");
  try {
    const apiRes = await auth.api.signInWithOAuth2({
      body: {
        providerId,
        callbackURL: back.toString(),
        errorCallbackURL: errorBack.toString(),
      },
      // Forward the preview host so Better Auth derives the correct baseURL /
      // redirect_uri for the dynamic `*.grok-sandbox.com` origin.
      headers: request.headers,
      asResponse: true,
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => "");
      return completionResponse({
        source: "grok-auth-popup",
        token: null,
        error: detail || `oauth_init_failed_${apiRes.status}`,
      });
    }

    const body = (await apiRes.json().catch(() => null)) as {
      url?: string;
    } | null;
    const location = body?.url;
    if (!location) {
      return completionResponse({
        source: "grok-auth-popup",
        token: null,
        error: "oauth_init_missing_url",
      });
    }

    // 302 to the broker (which headlessly forwards to Google/X). Forward any
    // Set-Cookie (OAuth state / PKCE) so the callback can complete in this popup.
    const headers = new Headers({ location, "cache-control": "no-store" });
    for (const cookie of apiRes.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }
    return new Response(null, { status: 302, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "oauth_init_threw";
    return completionResponse({
      source: "grok-auth-popup",
      token: null,
      error: message,
    });
  }
}

function completionResponse(message: PopupMessage): Response {
  return new Response(completionHtml(message), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function safeNonce(value: string | null): string {
  return (value ?? "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
}

function claimHandoff(nonce: string): Response {
  const row = readPopupHandoff(nonce);
  return Response.json(row ?? { token: null, user: null }, {
    headers: { "cache-control": "no-store" },
  });
}

async function storeHandoff(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    nonce?: string;
    token?: string;
    user?: HandoffUser | null;
  } | null;
  if (!body?.nonce || !body.token) {
    return Response.json({ ok: false }, { status: 400 });
  }
  const saved = savePopupHandoff({ nonce: body.nonce, token: body.token, user: body.user ?? null });
  return Response.json({ ok: saved }, { status: saved ? 200 : 400 });
}

/** Minimal HTML: tell the opener who signed in, then close. No React. */
function completionHtml(message: PopupMessage): string {
  // JSON is safe inside a <script type="application/json"> block; the inline
  // script only reads it. Avoids escaping pitfalls of embedding in JS source.
  const payload = JSON.stringify(message).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signing in…</title>
<style>
  html,body{margin:0;min-height:100%;background:#0b0b0c;color:#a1a1aa;
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{min-height:100vh;display:grid;place-items:center;padding:1.5rem;text-align:center}
</style>
</head>
<body>
<main><p>Signing you in…</p></main>
<script type="application/json" id="grok-auth-popup-msg">${payload}</script>
<script>
(function () {
  var el = document.getElementById("grok-auth-popup-msg");
  var msg = { source: "grok-auth-popup", token: null };
  try { if (el && el.textContent) msg = JSON.parse(el.textContent); } catch (e) {}
  function deliver() {
    try {
      if (msg.token) localStorage.setItem("grok-auth.bearer-token", msg.token);
      if (msg.user) {
        localStorage.setItem("readtube.account", JSON.stringify({
          displayName: msg.user.name || null,
          primaryEmail: msg.user.email || null,
          profileImageUrl: msg.user.image || null
        }));
      }
    } catch (e) {}
    try {
      if (window.opener && !window.opener.closed) window.opener.postMessage(msg, window.location.origin);
    } catch (e) {}
    try {
      var bc = new BroadcastChannel("readtube-auth-popup");
      bc.postMessage(msg);
      bc.close();
    } catch (e) {}
    if (msg.nonce && msg.token) {
      try {
        fetch("/auth/popup", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ nonce: msg.nonce, token: msg.token, user: msg.user || null })
        }).catch(function () {});
      } catch (e) {}
    }
  }
  deliver();
  var tries = 0;
  var timer = setInterval(function () {
    deliver();
    tries += 1;
    if (tries >= 30) {
      clearInterval(timer);
      try { window.close(); } catch (e) {}
    }
  }, 150);
})();
</script>
</body>
</html>`;
}

/** Profile from the popup's own session cookie, so the opener can paint a name with no extra round trip. */
async function readPopupUser(request: Request): Promise<PopupUser | null> {
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const session = await Promise.race([
      auth.api.getSession({ headers: request.headers }).finally(() => {
        if (timer) clearTimeout(timer);
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 200);
      }),
    ]);
    if (!session || typeof session !== "object" || !("user" in session) || !session.user) return null;
    const user = session.user as { name?: unknown; email?: unknown; image?: unknown };
    return {
      name: typeof user.name === "string" ? user.name : null,
      email: typeof user.email === "string" ? user.email : null,
      image: typeof user.image === "string" ? user.image : null,
    };
  } catch {
    return null;
  }
}

/** Read a single cookie value from the request (handles `=` inside values). */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Session cookie, including the names Better Auth uses when the prefix differs. */
function readSessionToken(request: Request): string | null {
  return (
    readCookie(request, SESSION_TOKEN_COOKIE) ??
    readCookie(request, "__Secure-better-auth.session_token") ??
    readCookie(request, "better-auth.session_token")
  );
}
