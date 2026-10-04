import { fetch as undiciFetch, ProxyAgent } from "undici";
import { thumbnailUrl, watchUrl } from "../youtube.ts";
import {
  fetchYtDlpCaptionFile,
  getYtDlpRuntime,
  sessionNeedsYtDlpFallback,
} from "./ytdlp.ts";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const ANDROID_UA =
  "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip";
const ANDROID_PLAYER_VERSION = "20.10.38";

const IOS_UA =
  "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)";
const IOS_PLAYER_VERSION = "21.26.4";

const VISIONOS_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const VISIONOS_PLAYER_VERSION = "1.02";

const YT_ORIGIN = "https://www.youtube.com";
const WEB_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const WEBSHARE_HOST = "p.webshare.io";
const PROXY_BLOCK_RETRIES = 8;

export function webshareRotatingUrl(username: string, password: string): string {
  const user = username.endsWith("-rotate") ? username : `${username}-rotate`;
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${WEBSHARE_HOST}:80/`;
}

export function resolveYouTubeProxyUrl(): string | null {
  const explicit = process.env.YOUTUBE_PROXY_URL?.trim();
  if (explicit) return explicit;
  const user = process.env.WEBSHARE_PROXY_USERNAME?.trim();
  const pass = process.env.WEBSHARE_PROXY_PASSWORD?.trim();
  if (user && pass) return webshareRotatingUrl(user, pass);
  return null;
}

export function youtubeProxyConfigured(): boolean {
  return Boolean(resolveYouTubeProxyUrl());
}

export function youtubeProxyEnvPresence(): {
  WEBSHARE_PROXY_USERNAME: boolean;
  WEBSHARE_PROXY_PASSWORD: boolean;
  YOUTUBE_PROXY_URL: boolean;
  configured: boolean;
} {
  return {
    WEBSHARE_PROXY_USERNAME: Boolean(process.env.WEBSHARE_PROXY_USERNAME?.trim()),
    WEBSHARE_PROXY_PASSWORD: Boolean(process.env.WEBSHARE_PROXY_PASSWORD?.trim()),
    YOUTUBE_PROXY_URL: Boolean(process.env.YOUTUBE_PROXY_URL?.trim()),
    configured: youtubeProxyConfigured(),
  };
}

let loggedProxyEnv = false;
function logYouTubeProxyEnvOnce(): void {
  if (loggedProxyEnv) return;
  loggedProxyEnv = true;
  console.info("[readtube] youtube proxy env", youtubeProxyEnvPresence());
}

let proxyAgent: ProxyAgent | undefined;
let proxyAgentFor: string | null = null;

function getProxyAgent(): ProxyAgent | undefined {
  const url = resolveYouTubeProxyUrl();
  if (!url) return undefined;
  if (!proxyAgent || proxyAgentFor !== url) {
    proxyAgent = new ProxyAgent({ uri: url, pipelining: 0 });
    proxyAgentFor = url;
  }
  return proxyAgent;
}

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  vssId?: string;
  isTranslatable?: boolean;
  name?: { simpleText?: string };
};

type PlayerResponse = {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    lengthSeconds?: string;
    title?: string;
    author?: string;
    shortDescription?: string;
    channelId?: string;
  };
  microformat?: {
    playerMicroformatRenderer?: {
      lengthSeconds?: string;
      ownerProfileUrl?: string;
      description?: { simpleText?: string };
    };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
      translationLanguages?: { languageCode?: string }[];
    };
  };
};

type Ytcfg = {
  INNERTUBE_API_KEY?: string;
  INNERTUBE_CLIENT_VERSION?: string;
  INNERTUBE_CLIENT_NAME?: string;
  INNERTUBE_CONTEXT?: {
    client?: Record<string, unknown>;
    [key: string]: unknown;
  };
  VISITOR_DATA?: string;
};

export type CaptionSegment = { startSeconds: number; text: string };

export type CaptionResult = {
  text: string;
  segments: CaptionSegment[];
  language: string;
  source: "youtube" | "youtube-asr" | "ytdlp";
};

export type FetchedMeta = {
  id: string;
  title: string;
  channelName: string;
  channelUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  description: string;
};

export type YouTubeContent = {
  meta: FetchedMeta;
  captions: CaptionResult | null;
  /** Set when captions are missing so the page can say why. */
  failure?: string;
};

class CookieJar {
  private cookies = new Map<string, string>();

  absorb(res: Response) {
    const listed =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : [];
    const rows = listed.length
      ? listed
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
    for (const row of rows) {
      const pair = row.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

function ytHeaders(jar: CookieJar, extra?: Record<string, string>): HeadersInit {
  const cookie = jar.header();
  const rotating = youtubeProxyConfigured();
  return {
    "User-Agent": CHROME_UA,
    "Accept-Language": "en-US,en;q=0.9",
    Accept: "*/*",
    Origin: YT_ORIGIN,
    Referer: `${YT_ORIGIN}/`,
    ...(rotating ? { Connection: "close" } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

async function ytFetch(
  url: string,
  jar: CookieJar,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  logYouTubeProxyEnvOnce();
  const { timeoutMs = 12000, headers, ...rest } = init;
  const dispatcher = getProxyAgent();
  const headerInit = ytHeaders(
    jar,
    headers as Record<string, string> | undefined,
  ) as Record<string, string>;
  const res = await undiciFetch(url, {
    method: rest.method,
    body: rest.body as string | undefined,
    headers: headerInit,
    signal: AbortSignal.timeout(timeoutMs),
    ...(dispatcher ? { dispatcher } : {}),
  });
  jar.absorb(res as unknown as Response);
  return res as unknown as Response;
}

type Session = {
  jar: CookieJar;
  html: string;
  player: PlayerResponse | null;
  ytcfg: Ytcfg | null;
  tracks: CaptionTrack[];
  playerUA: string;
};

async function openSessionOnce(videoId: string): Promise<Session> {
  const jar = new CookieJar();
  let html = "";
  try {
    const res = await ytFetch(watchUrl(videoId), jar, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      timeoutMs: 14000,
    });
    if (res.ok) html = await res.text();
  } catch {
    html = "";
  }

  const ytcfg = html ? parseYtcfg(html) : null;
  const fromApi = await fetchInnertubePlayer(videoId, jar, ytcfg);
  let player = fromApi?.player ?? (html ? pickPlayerResponse(html) : null);
  const playerUA = fromApi?.userAgent ?? CHROME_UA;
  if (fromApi?.player && html) {
    const htmlPlayer = pickPlayerResponse(html);
    player = mergePlayer(htmlPlayer, fromApi.player);
    if (captionTracksOf(fromApi.player).some((t) => !requiresPoToken(t.baseUrl))) {
      player = fromApi.player;
    }
  }
  const tracks = usableCaptionTracks(captionTracksOf(player));
  return { jar, html, player, ytcfg, tracks, playerUA };
}

async function openSession(videoId: string): Promise<Session> {
  const attempts = youtubeProxyConfigured() ? PROXY_BLOCK_RETRIES : 1;
  let last: Session | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await openSessionOnce(videoId);
    if (last.tracks.some((t) => !requiresPoToken(t.baseUrl))) return last;
    const status = last.player?.playabilityStatus?.status;
    const reason = (last.player?.playabilityStatus?.reason ?? "").toLowerCase();
    if (status === "ERROR") return last;
    if (reason.includes("inappropriate") || reason.includes("age")) return last;
    if (status === "OK" && last.tracks.length === 0) return last;
  }
  return last as Session;
}

export async function fetchYouTubeContent(
  videoId: string,
): Promise<YouTubeContent> {
  const fromLib = await withTimeout(fetchYoutubeiContentSafe(videoId), 12000);
  if (fromLib?.captions) return fromLib;

  const session = await openSession(videoId);
  const oembed = await fetchOembed(videoId);
  const meta = fromLib?.meta ?? metaFrom(videoId, session.player, oembed);
  const captions = await captionsFromSession(videoId, session);
  return { meta, captions, failure: captions ? undefined : explainMiss(session) };
}

function explainMiss(session: Session): string {
  const status = session.player?.playabilityStatus?.status ?? "";
  const reason = (session.player?.playabilityStatus?.reason ?? "").trim();
  const text = reason.toLowerCase();
  if (text.includes("private")) return "Private video";
  if (
    text.includes("age") ||
    text.includes("confirm your age") ||
    text.includes("sign in to confirm") && text.includes("age") ||
    text.includes("inappropriate")
  ) {
    return "Age restricted";
  }
  if (text.includes("members-only") || text.includes("members only") || text.includes("join this channel")) {
    return "Members-only video";
  }
  if (
    status === "ERROR" ||
    status === "UNPLAYABLE" ||
    text.includes("unavailable") ||
    text.includes("removed") ||
    text.includes("deleted") ||
    text.includes("terminated")
  ) {
    return "Video unavailable";
  }
  if (status === "LOGIN_REQUIRED") {
    return "YouTube blocked the transcript request. Try again in a moment.";
  }
  if (reason) return reason;
  return "No transcript available";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

async function fetchYoutubeiContentSafe(
  videoId: string,
): Promise<YouTubeContent | null> {
  try {
    const { fetchYoutubeiContent } = await import("./youtubei-captions.ts");
    return await fetchYoutubeiContent(videoId);
  } catch (err) {
    console.info(
      "[readtube] youtubei import failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function fetchVideoMeta(
  videoId: string,
): Promise<FetchedMeta | null> {
  const content = await fetchYouTubeContent(videoId);
  return content.meta;
}

export async function fetchCaptions(
  videoId: string,
): Promise<CaptionResult | null> {
  const content = await fetchYouTubeContent(videoId);
  return content.captions;
}

export async function inspectCaptionDiscovery(videoId: string): Promise<{
  playability: string | null;
  stub: boolean;
  trackCount: number;
  tracks: {
    languageCode?: string;
    kind?: string;
    vssId?: string;
    asr: boolean;
    translatable: boolean;
  }[];
  selected: {
    languageCode?: string;
    asr: boolean;
    translateTo?: string;
  } | null;
  captions: CaptionResult | null;
  durationSeconds: number;
  words: number;
  passesGate: boolean;
  proxyConfigured: boolean;
  ytdlp: {
    attempted: boolean;
    canRun: boolean;
    vercel: boolean;
    reason: string;
    used: boolean;
  };
  youtubei: {
    attempted: boolean;
    used: boolean;
  };
}> {
  const fromLib = await fetchYoutubeiContentSafe(videoId);
  const session = await openSession(videoId);
  const selected = selectCaptionTrack(session.tracks);
  const captions =
    fromLib?.captions ?? (await captionsFromSession(videoId, session));
  const duration =
    fromLib?.meta.durationSeconds ||
    Number(session.player?.videoDetails?.lengthSeconds) ||
    Number(
      session.player?.microformat?.playerMicroformatRenderer?.lengthSeconds,
    ) ||
    0;
  const words = captions?.text.trim().split(/\s+/).filter(Boolean).length ?? 0;
  const ytdlpRuntime = await getYtDlpRuntime();
  const needsFallback = sessionNeedsYtDlpFallback(session);
  return {
    playability: session.player?.playabilityStatus?.status ?? null,
    stub: isStubPlayer(session.player),
    trackCount: session.tracks.length || (fromLib?.captions ? 1 : 0),
    tracks: session.tracks.map((t) => ({
      languageCode: t.languageCode,
      kind: t.kind,
      vssId: t.vssId,
      asr: isAsrTrack(t),
      translatable: Boolean(t.isTranslatable),
    })),
    selected: selected
      ? {
          languageCode: selected.track.languageCode,
          asr: isAsrTrack(selected.track),
          translateTo: selected.translateTo,
        }
      : fromLib?.captions
        ? {
            languageCode: fromLib.captions.language,
            asr: fromLib.captions.source === "youtube-asr",
          }
        : null,
    captions,
    durationSeconds: duration,
    words,
    passesGate: captions
      ? transcriptPassesGate(captions.text, duration)
      : false,
    proxyConfigured: youtubeProxyConfigured(),
    ytdlp: {
      attempted: needsFallback,
      canRun: ytdlpRuntime.canRun,
      vercel: ytdlpRuntime.vercel,
      reason: ytdlpRuntime.reason,
      used: captions?.source === "ytdlp",
    },
    youtubei: {
      attempted: true,
      used: Boolean(fromLib?.captions),
    },
  };
}

function summarizeTracks(tracks: CaptionTrack[]) {
  return tracks.map((t) => ({
    languageCode: t.languageCode ?? null,
    kind: t.kind ?? null,
    vssId: t.vssId ?? null,
    translatable: Boolean(t.isTranslatable),
    requiresPoToken: requiresPoToken(t.baseUrl),
    baseUrlPrefix: (t.baseUrl ?? "").slice(0, 160),
  }));
}

function captionsSummary(player: PlayerResponse | null) {
  const renderer = player?.captions?.playerCaptionsTracklistRenderer;
  const tracks = captionTracksOf(player);
  return {
    captionsKeyPresent: Boolean(player?.captions),
    rendererPresent: Boolean(renderer),
    captionTracksCount: tracks.length,
    tracks: summarizeTracks(tracks),
  };
}

export async function diagnoseYouTubeFetch(videoId: string) {
  const jar = new CookieJar();
  let watchStatus = 0;
  let html = "";
  let watchError: string | null = null;
  try {
    const watch = await ytFetch(watchUrl(videoId), jar, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      timeoutMs: 14000,
    });
    watchStatus = watch.status;
    html = await watch.text();
  } catch (err) {
    watchError = err instanceof Error ? err.message : String(err);
  }

  const htmlPlayer = html ? pickPlayerResponse(html) : null;
  const ytcfg = html ? parseYtcfg(html) : null;
  const webKey = ytcfg?.INNERTUBE_API_KEY ?? WEB_API_KEY;

  let androidStatus = 0;
  let androidJson: PlayerResponse | null = null;
  let androidError: string | null = null;
  try {
    const androidRes = await ytFetch(
      `${YT_ORIGIN}/youtubei/v1/player?key=${encodeURIComponent(webKey)}`,
      jar,
      {
        method: "POST",
        timeoutMs: 12000,
        headers: { "Content-Type": "application/json", Referer: watchUrl(videoId) },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "ANDROID",
              clientVersion: ANDROID_PLAYER_VERSION,
            },
          },
          videoId,
        }),
      },
    );
    androidStatus = androidRes.status;
    androidJson = (await androidRes.json()) as PlayerResponse;
  } catch (err) {
    androidError = err instanceof Error ? err.message : String(err);
  }

  const androidTracks = captionTracksOf(androidJson);
  const htmlTracks = captionTracksOf(htmlPlayer);
  const chosenTracks =
    androidTracks.some((t) => !requiresPoToken(t.baseUrl))
      ? androidTracks
      : htmlTracks;
  const selected = selectCaptionTrack(chosenTracks);

  let timedtext: {
    attempted: boolean;
    reason?: string;
    status?: number;
    contentType?: string | null;
    bytes?: number;
    snippet?: string;
    parsedSegments?: number;
  } = { attempted: false, reason: "no captionTracks in player responses" };

  if (selected?.track.baseUrl) {
    try {
      const res = await ytFetch(selected.track.baseUrl, jar, {
        headers: { Referer: watchUrl(videoId), Accept: "*/*" },
        timeoutMs: 10000,
      });
      const body = await res.text();
      const parsed = parseCaptionBody(body);
      timedtext = {
        attempted: true,
        status: res.status,
        contentType: res.headers.get("content-type"),
        bytes: body.length,
        snippet: body.slice(0, 220).replace(/\s+/g, " "),
        parsedSegments: parsed?.segments.length ?? 0,
      };
    } catch (err) {
      timedtext = {
        attempted: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    videoId,
    proxyConfigured: youtubeProxyConfigured(),
    watchPage: {
      httpStatus: watchStatus,
      error: watchError,
      htmlBytes: html.length,
      hasYtInitialPlayerResponse: html.includes("ytInitialPlayerResponse"),
      hasCaptionsTracksLiteral: html.includes("captionTracks"),
      hasRecaptcha: html.includes("g-recaptcha"),
      botWallText: html.includes("Sign in to confirm you’re not a bot")
        || html.includes("Sign in to confirm you're not a bot"),
      playabilityStatus: htmlPlayer?.playabilityStatus ?? null,
      captions: captionsSummary(htmlPlayer),
    },
    androidPlayer: {
      httpStatus: androidStatus,
      error: androidError,
      playabilityStatus: androidJson?.playabilityStatus ?? null,
      videoDetailsTitle: androidJson?.videoDetails?.title ?? null,
      captions: captionsSummary(androidJson),
    },
    timedtext,
    conclusion:
      chosenTracks.length === 0
        ? "NO_CAPTION_TRACKS — YouTube player responses contain no captionTracks. Timedtext was not requested. This is not a parser miss."
        : timedtext.parsedSegments
          ? "CAPTION_BYTES_OK"
          : "TRACKS_PRESENT_BUT_BODY_EMPTY_OR_UNPARSED",
  };
}

async function captionsFromSession(
  videoId: string,
  session: Session,
): Promise<CaptionResult | null> {
  const selected = selectCaptionTrack(session.tracks);
  if (selected) {
    const timed =
      (await downloadTimedText(
        selected.track.baseUrl as string,
        videoId,
        session.jar,
        selected.translateTo,
        session.playerUA,
      )) ??
      (selected.translateTo
        ? await downloadTimedText(
            selected.track.baseUrl as string,
            videoId,
            session.jar,
            undefined,
            session.playerUA,
          )
        : null);
    if (timed) {
      const language =
        selected.translateTo ?? selected.track.languageCode ?? "en";
      const asr = isAsrTrack(selected.track) || Boolean(selected.translateTo);
      return finalizeCaptions(timed, language, asr ? "youtube-asr" : "youtube");
    }
  }

  const panel = await fetchPanelTranscript(videoId, session);
  if (panel) return finalizeCaptions(panel, panel.language, panel.source);
  if (sessionNeedsYtDlpFallback(session) || selected) {
    const file = await fetchYtDlpCaptionFile(videoId, resolveYouTubeProxyUrl());
    if (file) {
      const parsed = parseCaptionBody(file.body);
      if (parsed?.segments.length) {
        return finalizeCaptions(
          parsed,
          file.language || "en",
          "ytdlp",
        );
      }
    }
  }
  return null;
}

async function downloadTimedText(
  baseUrl: string,
  videoId: string,
  jar: CookieJar,
  tlang?: string,
  userAgent?: string,
): Promise<{ text: string; segments: CaptionSegment[] } | null> {
  const candidates = [
    baseUrl,
    rewriteTimedTextUrl(baseUrl, "json3", tlang),
    rewriteTimedTextUrl(baseUrl, "srv3", tlang),
    rewriteTimedTextUrl(baseUrl, null, tlang),
    rewriteTimedTextUrl(baseUrl, "vtt", tlang),
  ];
  const seen = new Set<string>();
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await ytFetch(url, jar, {
        headers: {
          Referer: watchUrl(videoId),
          Accept: "*/*",
          ...(userAgent ? { "User-Agent": userAgent } : {}),
        },
        timeoutMs: 10000,
      });
      if (!res.ok) continue;
      const body = await res.text();
      const parsed = parseCaptionBody(body);
      if (parsed && parsed.segments.length > 0) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchPanelTranscript(
  videoId: string,
  session: Session,
): Promise<CaptionResult | null> {
  if (!session.html || !session.ytcfg?.INNERTUBE_CONTEXT) return null;
  const params = findTranscriptParams(session.html);
  if (!params) return null;
  const key = session.ytcfg.INNERTUBE_API_KEY ?? WEB_API_KEY;
  const visitor =
    session.ytcfg.VISITOR_DATA ??
    (session.ytcfg.INNERTUBE_CONTEXT.client?.visitorData as string | undefined);
  try {
    const res = await ytFetch(
      `${YT_ORIGIN}/youtubei/v1/get_transcript?prettyPrint=false&key=${encodeURIComponent(key)}`,
      session.jar,
      {
        method: "POST",
        timeoutMs: 12000,
        headers: {
          "Content-Type": "application/json",
          Referer: watchUrl(videoId),
          ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
        },
        body: JSON.stringify({
          context: session.ytcfg.INNERTUBE_CONTEXT,
          params,
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const segments = parseTranscriptPanel(json);
    if (!segments.length) return null;
    return {
      text: segments.map((s) => s.text).join(" "),
      segments,
      language: "en",
      source: "youtube",
    };
  } catch {
    return null;
  }
}

async function fetchInnertubePlayer(
  videoId: string,
  jar: CookieJar,
  ytcfg: Ytcfg | null,
): Promise<{ player: PlayerResponse; userAgent: string } | null> {
  const attempts: Array<{
    url: string;
    body: unknown;
    headers?: Record<string, string>;
    userAgent: string;
  }> = [];

  const webKey = ytcfg?.INNERTUBE_API_KEY ?? WEB_API_KEY;
  const visitor =
    ytcfg?.VISITOR_DATA ??
    (ytcfg?.INNERTUBE_CONTEXT?.client?.visitorData as string | undefined);

  // ANDROID still returns captionTracks without a poToken from most server IPs.
  // WEB/VISIONOS often come back UNPLAYABLE or LOGIN_REQUIRED.
  attempts.push({
    url: `${YT_ORIGIN}/youtubei/v1/player?key=${encodeURIComponent(webKey)}`,
    userAgent: ANDROID_UA,
    body: {
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: ANDROID_PLAYER_VERSION,
          androidSdkVersion: 30,
          osName: "Android",
          osVersion: "11",
          hl: "en",
          gl: "US",
          ...(visitor ? { visitorData: visitor } : {}),
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
  });

  attempts.push({
    url: `${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(webKey)}`,
    userAgent: IOS_UA,
    headers: {
      "X-YouTube-Client-Name": "5",
      "X-YouTube-Client-Version": IOS_PLAYER_VERSION,
      ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
    },
    body: {
      context: {
        client: {
          clientName: "IOS",
          clientVersion: IOS_PLAYER_VERSION,
          deviceMake: "Apple",
          deviceModel: "iPhone16,2",
          userAgent: IOS_UA,
          osName: "iPhone",
          osVersion: "18.3.2.22D82",
          hl: "en",
          gl: "US",
          ...(visitor ? { visitorData: visitor } : {}),
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
  });

  attempts.push({
    url: `${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(webKey)}`,
    userAgent: VISIONOS_UA,
    headers: {
      "X-YouTube-Client-Name": "101",
      "X-YouTube-Client-Version": VISIONOS_PLAYER_VERSION,
      ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
    },
    body: {
      context: {
        client: {
          clientName: "VISIONOS",
          clientVersion: VISIONOS_PLAYER_VERSION,
          deviceMake: "Apple",
          deviceModel: "RealityDevice17,1",
          userAgent: VISIONOS_UA,
          osName: "visionOS",
          osVersion: "26.5.23O471",
          hl: "en",
          gl: "US",
          ...(visitor ? { visitorData: visitor } : {}),
        },
      },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    },
  });

  if (ytcfg?.INNERTUBE_CONTEXT) {
    attempts.push({
      url: `${YT_ORIGIN}/youtubei/v1/player?prettyPrint=false&key=${encodeURIComponent(webKey)}`,
      userAgent: CHROME_UA,
      body: {
        context: ytcfg.INNERTUBE_CONTEXT,
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      },
      headers: {
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version":
          ytcfg.INNERTUBE_CLIENT_VERSION ?? "2.20260828.01.00",
        ...(visitor ? { "X-Goog-Visitor-Id": visitor } : {}),
      },
    });
  }

  for (const attempt of attempts) {
    try {
      const res = await ytFetch(attempt.url, jar, {
        method: "POST",
        timeoutMs: 12000,
        headers: {
          "Content-Type": "application/json",
          Referer: watchUrl(videoId),
          "User-Agent": attempt.userAgent,
          ...attempt.headers,
        },
        body: JSON.stringify(attempt.body),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as PlayerResponse;
      if (isStubPlayer(json) && captionTracksOf(json).length === 0) continue;
      if (captionTracksOf(json).length > 0 || json.videoDetails) {
        return { player: json, userAgent: attempt.userAgent };
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchOembed(videoId: string): Promise<{
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
} | null> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
    const jar = new CookieJar();
    const res = await ytFetch(oembedUrl, jar, {
      headers: { Accept: "application/json" },
      timeoutMs: 8000,
    });
    if (!res.ok) return null;
    return (await res.json()) as {
      title?: string;
      author_name?: string;
      author_url?: string;
      thumbnail_url?: string;
    };
  } catch {
    return null;
  }
}

function metaFrom(
  videoId: string,
  player: PlayerResponse | null,
  oembed: {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
  } | null,
): FetchedMeta {
  const details = player?.videoDetails;
  const micro = player?.microformat?.playerMicroformatRenderer;
  const duration = Number(details?.lengthSeconds) || Number(micro?.lengthSeconds) || 0;
  return {
    id: videoId,
    title: oembed?.title || details?.title || `YouTube video ${videoId}`,
    channelName: oembed?.author_name || details?.author || "YouTube",
    channelUrl:
      oembed?.author_url ||
      micro?.ownerProfileUrl ||
      "https://www.youtube.com",
    thumbnailUrl: oembed?.thumbnail_url || thumbnailUrl(videoId),
    durationSeconds: duration,
    description: details?.shortDescription || micro?.description?.simpleText || "",
  };
}

function mergePlayer(
  htmlPlayer: PlayerResponse | null,
  apiPlayer: PlayerResponse,
): PlayerResponse {
  if (!htmlPlayer || isStubPlayer(htmlPlayer)) return apiPlayer;
  if (captionTracksOf(htmlPlayer).length === 0 && captionTracksOf(apiPlayer).length) {
    return { ...htmlPlayer, captions: apiPlayer.captions };
  }
  return htmlPlayer;
}

export function isStubPlayer(player: PlayerResponse | null | undefined): boolean {
  if (!player) return true;
  const status = player.playabilityStatus?.status;
  const tracks = captionTracksOf(player);
  if (tracks.length > 0) return false;
  if (status === "LOGIN_REQUIRED" || status === "ERROR") return true;
  if (!player.videoDetails && status !== "OK") return true;
  return false;
}

function captionTracksOf(player: PlayerResponse | null | undefined): CaptionTrack[] {
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks.filter((t) => t?.baseUrl) : [];
}

export function requiresPoToken(baseUrl?: string): boolean {
  return Boolean(baseUrl && baseUrl.includes("exp=xpe"));
}

function usableCaptionTracks(tracks: CaptionTrack[]): CaptionTrack[] {
  const withoutPot = tracks.filter((t) => t.baseUrl && !requiresPoToken(t.baseUrl));
  return withoutPot.length ? withoutPot : tracks;
}

function parseYtcfg(html: string): Ytcfg | null {
  const match = html.match(/ytcfg\.set\(\s*(\{[\s\S]*?\})\s*\);/);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]) as Ytcfg;
  } catch {
    return null;
  }
}

function pickPlayerResponse(html: string): PlayerResponse | null {
  const blobs = extractJsonBlobs(html, "ytInitialPlayerResponse");
  let fallback: PlayerResponse | null = null;
  for (const blob of blobs) {
    try {
      const parsed = JSON.parse(blob) as PlayerResponse;
      if (captionTracksOf(parsed).length > 0) return parsed;
      if (!fallback && !isStubPlayer(parsed)) fallback = parsed;
      if (!fallback) fallback = parsed;
    } catch {
      continue;
    }
  }
  return fallback;
}

function extractJsonBlobs(html: string, marker: string): string[] {
  const out: string[] = [];
  let from = 0;
  while (from < html.length) {
    const idx = html.indexOf(marker, from);
    if (idx === -1) break;
    const brace = html.indexOf("{", idx);
    if (brace === -1) break;
    try {
      const json = sliceBalancedObject(html, brace);
      out.push(json);
      from = brace + json.length;
    } catch {
      from = idx + marker.length;
    }
  }
  return out;
}

function sliceBalancedObject(source: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced");
}

function findTranscriptParams(html: string): string | null {
  const dataBlobs = extractJsonBlobs(html, "ytInitialData");
  for (const blob of dataBlobs) {
    try {
      const data = JSON.parse(blob) as unknown;
      const params = walkFind(data, "getTranscriptEndpoint") as
        | { params?: string }
        | undefined;
      if (params?.params) return params.params;
    } catch {
      continue;
    }
  }
  return null;
}

function walkFind(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = walkFind(item, key);
      if (found) return found;
    }
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const child of Object.values(rec)) {
    const found = walkFind(child, key);
    if (found) return found;
  }
  return undefined;
}

function parseTranscriptPanel(json: unknown): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const rec = value as Record<string, unknown>;
    const renderer = rec.transcriptSegmentRenderer as
      | {
          startMs?: string | number;
          startTimeMs?: string | number;
          snippet?: { simpleText?: string; runs?: { text?: string }[] };
        }
      | undefined;
    if (renderer) {
      const start = Number(renderer.startMs ?? renderer.startTimeMs ?? 0) / 1000;
      const snippet = renderer.snippet;
      const text = snippet?.simpleText
        ? snippet.simpleText
        : (snippet?.runs ?? []).map((r) => r.text ?? "").join("");
      const cleaned = decodeCaption(text);
      if (cleaned) segments.push({ startSeconds: start, text: cleaned });
    }
    for (const child of Object.values(rec)) visit(child);
  };
  visit(json);
  return segments;
}

export function isEnglishLang(code?: string): boolean {
  const c = (code ?? "").toLowerCase().replace("_", "-");
  return c === "en" || c.startsWith("en-");
}

export function isAsrTrack(track: {
  kind?: string;
  vssId?: string;
  name?: { simpleText?: string };
}): boolean {
  if (track.kind === "asr") return true;
  if ((track.vssId ?? "").startsWith("a.")) return true;
  const name = (track.name?.simpleText ?? "").toLowerCase();
  return name.includes("auto-generated") || name.includes("automatic");
}

export function selectCaptionTrack(tracks: CaptionTrack[]): {
  track: CaptionTrack;
  translateTo?: string;
} | null {
  const usable = tracks.filter((t) => t.baseUrl);
  if (!usable.length) return null;

  const manualEn = usable.find(
    (t) => isEnglishLang(t.languageCode) && !isAsrTrack(t),
  );
  if (manualEn) return { track: manualEn };

  const asrEn = usable.find(
    (t) => isEnglishLang(t.languageCode) && isAsrTrack(t),
  );
  if (asrEn) return { track: asrEn };

  const anyEn = usable.find((t) => isEnglishLang(t.languageCode));
  if (anyEn) return { track: anyEn };

  const translatable = usable.find((t) => t.isTranslatable);
  if (translatable) return { track: translatable, translateTo: "en" };

  const first = usable[0];
  if (!isEnglishLang(first.languageCode)) {
    return { track: first, translateTo: "en" };
  }
  return { track: first };
}

export function rewriteTimedTextUrl(
  baseUrl: string,
  fmt: string | null,
  tlang?: string,
): string {
  const absolute = baseUrl.startsWith("//") ? `https:${baseUrl}` : baseUrl;
  let url = absolute
    .replace(/([?&])fmt=[^&]*/g, "$1")
    .replace(/([?&])tlang=[^&]*/g, "$1")
    .replace(/&&+/g, "&")
    .replace(/\?&/g, "?")
    .replace(/[?&]$/g, "");
  const append = (key: string, value: string) => {
    url += `${url.includes("?") ? "&" : "?"}${key}=${value}`;
  };
  if (fmt) append("fmt", fmt);
  if (tlang) append("tlang", tlang);
  return url;
}

export function parseCaptionBody(
  body: string,
): { text: string; segments: CaptionSegment[] } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return parseJson3(trimmed);
  if (/WEBVTT/i.test(trimmed.slice(0, 80))) return parseVtt(trimmed);
  return parseSrv3(trimmed);
}

export function parseJson3(
  raw: string,
): { text: string; segments: CaptionSegment[] } | null {
  try {
    const obj = JSON.parse(raw) as {
      events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
    };
    const segments: CaptionSegment[] = [];
    for (const ev of obj.events ?? []) {
      if (!ev.segs?.length) continue;
      const text = decodeCaption(
        ev.segs
          .map((s) => s.utf8 ?? "")
          .join("")
          .replace(/\n/g, " "),
      );
      if (!text) continue;
      segments.push({
        startSeconds: (ev.tStartMs ?? 0) / 1000,
        text,
      });
    }
    if (!segments.length) return null;
    return { text: segments.map((s) => s.text).join(" "), segments };
  } catch {
    return null;
  }
}

export function parseSrv3(
  xml: string,
): { text: string; segments: CaptionSegment[] } | null {
  const segments: CaptionSegment[] = [];
  const pRe = /<p\b(?![^>]*\/>)[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRe.exec(xml))) {
    const text = decodeCaption(match[2]);
    if (text) segments.push({ startSeconds: Number(match[1]) / 1000, text });
  }
  if (segments.length === 0) {
    const textRe = /<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
    while ((match = textRe.exec(xml))) {
      const text = decodeCaption(match[2]);
      if (text) {
        segments.push({ startSeconds: Number(match[1]), text });
      }
    }
  }
  if (!segments.length) return null;
  return { text: segments.map((s) => s.text).join(" "), segments };
}

export function parseVtt(
  raw: string,
): { text: string; segments: CaptionSegment[] } | null {
  const segments: CaptionSegment[] = [];
  const blocks = raw.replace(/^\uFEFF/, "").split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (!lines.length) continue;
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) continue;
    const startToken = timeLine.split("-->")[0]?.trim() ?? "";
    const start = parseVttTimestamp(startToken);
    const textLines = lines.filter((l) => !l.includes("-->") && !/^\d+$/.test(l));
    const text = decodeCaption(
      textLines
        .join(" ")
        .replace(/<c[^>]*>/g, "")
        .replace(/<\/c>/g, "")
        .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, ""),
    );
    if (text) segments.push({ startSeconds: start, text });
  }
  if (!segments.length) return null;
  return { text: segments.map((s) => s.text).join(" "), segments };
}

function parseVttTimestamp(value: string): number {
  const clean = value.replace(/[^\d:.]/g, "");
  const parts = clean.split(":");
  if (parts.length === 3) {
    return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2] || 0);
  }
  if (parts.length === 2) {
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }
  return Number(clean) || 0;
}

export function decodeCaption(raw: string): string {
  const withoutTags = raw
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags)
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/\u0026nbsp;/gi, " ")
    .replace(/\u0026amp;/gi, "&")
    .replace(/\u0026quot;/gi, '"')
    .replace(/\u0026apos;/gi, "'")
    .replace(/\u0026#39;/g, "'")
    .replace(/\u0026#x27;/gi, "'")
    .replace(/\u0026lt;/gi, "<")
    .replace(/\u0026gt;/gi, ">")
    .replace(/\u0026#(\d+);/g, (_, n: string) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    })
    .replace(/\u0026#x([0-9a-f]+);/gi, (_, n: string) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

export function mergeAsrWindows(segments: CaptionSegment[]): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  let lastRaw = "";
  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const added = lastRaw ? stripOverlap(lastRaw, text) : text;
    lastRaw = text;
    if (!added) continue;
    out.push({ startSeconds: seg.startSeconds, text: added });
  }
  return out;
}

function stripOverlap(prev: string, next: string): string {
  const a = prev.split(/\s+/);
  const b = next.split(/\s+/);
  const max = Math.min(a.length, b.length);
  for (let n = max; n > 0; n -= 1) {
    let match = true;
    for (let i = 0; i < n; i += 1) {
      if (a[a.length - n + i].toLowerCase() !== b[i].toLowerCase()) {
        match = false;
        break;
      }
    }
    if (match) return b.slice(n).join(" ");
  }
  return next;
}

export function reconstructSentences(
  segments: CaptionSegment[],
): CaptionSegment[] {
  if (!segments.length) return [];
  const GAP = 12;
  const out: CaptionSegment[] = [];
  let buf = "";
  let start = segments[0].startSeconds;
  let lastTime = segments[0].startSeconds;

  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim();
    if (text) out.push({ startSeconds: start, text });
    buf = "";
  };

  for (const seg of segments) {
    const piece = seg.text.trim();
    if (!piece) continue;
    const gap = seg.startSeconds - lastTime;
    lastTime = seg.startSeconds;
    if (!buf) {
      start = seg.startSeconds;
      buf = piece;
    } else if (gap > GAP && buf.split(/\s+/).length >= 6) {
      flush();
      start = seg.startSeconds;
      buf = piece;
    } else {
      const space = buf.endsWith(" ") || piece.startsWith(" ") ? "" : " ";
      buf += space + piece;
    }
    if (/[.?!]["']?$/.test(buf) && buf.split(/\s+/).length >= 5) flush();
  }
  flush();
  return out.length ? out : segments;
}

const FILLER = new Set(["uh", "um", "uhh", "umm", "erm", "ah", "huh"]);

export function cleanTranscriptText(raw: string): string {
  let text = raw
    .replace(/\[(?:Music|Applause|Laughter|silence|Cheering)\]/gi, " ")
    .replace(/\b(?:Transcriber|Translator|Reviewer):\s*[A-ZÀ-ÖØ-Þ][\p{L}.'’\-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}.'’\-]+){0,3}/giu, " ")
    .replace(/>>\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const sentences = text.split(/(?<=[.?!])\s+/);
  const deduped: string[] = [];
  for (const sentence of sentences) {
    if (!sentence) continue;
    const prev = deduped[deduped.length - 1];
    if (prev && prev.toLowerCase() === sentence.toLowerCase()) continue;
    deduped.push(sentence);
  }
  text = deduped.join(" ");

  text = text
    .split(/\s+/)
    .filter((token) => {
      const norm = token.toLowerCase().replace(/[^a-z']/g, "");
      return !FILLER.has(norm);
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function transcriptWordThreshold(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 40;
  return Math.min(80, Math.max(25, Math.round(durationSeconds * 1.2)));
}

export function transcriptPassesGate(
  text: string,
  durationSeconds: number,
): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words >= transcriptWordThreshold(durationSeconds);
}

export function finalizeCaptions(
  parsed: { text: string; segments: CaptionSegment[] },
  language: string,
  source: CaptionResult["source"],
): CaptionResult {
  const merged = mergeAsrWindows(parsed.segments);
  const sentences = reconstructSentences(merged);
  const segments = sentences
    .map((s) => ({ ...s, text: cleanTranscriptText(s.text) }))
    .filter((s) => s.text);
  const text = cleanTranscriptText(
    (segments.length ? segments : merged).map((s) => s.text).join(" "),
  );
  return {
    text,
    segments: segments.length ? segments : merged,
    language,
    source,
  };
}
