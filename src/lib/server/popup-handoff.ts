/**
 * One-time hand-off of a popup session back to the page that opened it.
 *
 * The preview iframe cannot see the popup's cookies or localStorage (they are
 * partitioned). The completion page stores the token here; the opener reads it
 * by the nonce it put on the popup URL. Memory is enough for one server
 * process. Deployed top-level windows also share storage, so this is a backup
 * there, not the only path.
 */

export type HandoffUser = {
  name: string | null;
  email: string | null;
  image: string | null;
};

export type PopupHandoff = {
  token: string;
  user: HandoffUser | null;
};

type Row = PopupHandoff & { expires: number };

const TTL_MS = 2 * 60 * 1000;
const SESSION_DATA_COOKIE = "__Host-grok-auth.session_data";

function bucket(): Map<string, Row> {
  const g = globalThis as { __readtubePopupHandoff?: Map<string, Row> };
  g.__readtubePopupHandoff ??= new Map();
  return g.__readtubePopupHandoff;
}

function cleanNonce(nonce: string): string {
  return nonce.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
}

export function savePopupHandoff(input: { nonce: string; token: string; user?: HandoffUser | null }): boolean {
  const nonce = cleanNonce(input.nonce);
  const token = input.token.trim();
  if (!nonce || !token) return false;
  const map = bucket();
  const prev = map.get(nonce);
  map.set(nonce, {
    token,
    // A later save without a profile must not wipe a name we already stored.
    user: input.user ?? prev?.user ?? null,
    expires: Date.now() + TTL_MS,
  });
  return true;
}

/** Attach a profile to a handoff the opener may already be reading. */
export function rememberPopupUser(nonce: string, user: HandoffUser | null): void {
  if (!user) return;
  const id = cleanNonce(nonce);
  if (!id) return;
  const row = bucket().get(id);
  if (!row || row.expires < Date.now()) return;
  row.user = user;
}

/**
 * Read without deleting. The opener polls until the profile arrives; a
 * single-use take dropped the name when the token and the profile landed
 * on different polls.
 */
export function readPopupHandoff(nonce: string): PopupHandoff | null {
  const id = cleanNonce(nonce);
  if (!id) return null;
  const row = bucket().get(id);
  if (!row) return null;
  if (row.expires < Date.now()) {
    bucket().delete(id);
    return null;
  }
  return { token: row.token, user: row.user };
}

/** @deprecated Use readPopupHandoff. Kept so older callers still compile. */
export function takePopupHandoff(nonce: string): PopupHandoff | null {
  const row = readPopupHandoff(nonce);
  if (!row) return null;
  bucket().delete(cleanNonce(nonce));
  return row;
}

function cookieMap(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq);
    const raw = trimmed.slice(eq + 1);
    try {
      cookies.set(key, decodeURIComponent(raw));
    } catch {
      cookies.set(key, raw);
    }
  }
  return cookies;
}

/**
 * Name and avatar from Better Auth's compact session cookie.
 * Synchronous on purpose: waiting on getSession held the token away from the
 * opener, so the header stayed on Sign in after Google had already returned.
 */
export function userFromSessionDataCookie(cookieHeader: string | null): HandoffUser | null {
  if (!cookieHeader) return null;
  const cookies = cookieMap(cookieHeader);
  let raw = cookies.get(SESSION_DATA_COOKIE) ?? null;
  if (!raw) {
    const chunks: { index: number; value: string }[] = [];
    for (const [key, value] of cookies) {
      if (!key.startsWith(`${SESSION_DATA_COOKIE}.`)) continue;
      const index = Number(key.slice(SESSION_DATA_COOKIE.length + 1));
      if (Number.isInteger(index)) chunks.push({ index, value });
    }
    if (chunks.length) {
      chunks.sort((a, b) => a.index - b.index);
      raw = chunks.map((chunk) => chunk.value).join("");
    }
  }
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const payload = JSON.parse(json) as {
      session?: { user?: { name?: unknown; email?: unknown; image?: unknown } };
    };
    const user = payload.session?.user;
    if (!user) return null;
    const account: HandoffUser = {
      name: typeof user.name === "string" ? user.name : null,
      email: typeof user.email === "string" ? user.email : null,
      image: typeof user.image === "string" ? user.image : null,
    };
    if (!account.name && !account.email && !account.image) return null;
    return account;
  } catch {
    return null;
  }
}
