const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const ID_SRC = "[A-Za-z0-9_-]{11}";

function scrub(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF\u2060\u00A0]/g, "")
    .replace(/&/gi, "&")
    .trim();
}

function idFromText(text: string): string | null {
  const direct = text.match(
    new RegExp(
      `(?:youtu\\.be/|youtube(?:-nocookie)?\\.com/(?:embed/|shorts/|live/|v/|e/|watch\\?(?:[^\\s#]*&)?v=))(${ID_SRC})`,
      "i",
    ),
  );
  if (direct?.[1] && ID_RE.test(direct[1])) return direct[1];
  const watch = text.match(new RegExp(`[?&]v=(${ID_SRC})\\b`, "i"));
  if (watch?.[1] && ID_RE.test(watch[1])) return watch[1];
  return null;
}

function idFromUrl(token: string): string | null {
  const raw = token.trim().replace(/^[<("']+|[)\].,'">]+$/g, "");
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");

  if (host === "youtu.be") {
    const id = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] ?? "");
    return ID_RE.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com" || host.endsWith(".youtube.com")) {
    const v = url.searchParams.get("v");
    if (v && ID_RE.test(v)) return v;

    const parts = url.pathname.split("/").filter(Boolean);
    const kind = parts[0];
    const next = parts[1] ?? "";
    if (
      (kind === "embed" || kind === "shorts" || kind === "live" || kind === "v" || kind === "e") &&
      ID_RE.test(next)
    ) {
      return next;
    }
    if (kind === "attribution_link") {
      const buried = url.searchParams.get("u");
      if (buried) {
        try {
          return idFromText(decodeURIComponent(buried));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function parseYouTubeId(input: string): string | null {
  const raw = scrub(input);
  if (!raw) return null;
  if (ID_RE.test(raw)) return raw;

  const whole = idFromUrl(raw);
  if (whole) return whole;

  for (const token of raw.split(/\s+/)) {
    const hit = idFromUrl(token) ?? idFromText(token);
    if (hit) return hit;
  }

  const fromText = idFromText(raw);
  if (fromText) return fromText;

  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) return idFromText(decoded) ?? idFromUrl(decoded);
  } catch {
    /* pasted text is not a single escape sequence */
  }
  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function isLikelyYouTubeUrl(input: string): boolean {
  return parseYouTubeId(input) !== null;
}
