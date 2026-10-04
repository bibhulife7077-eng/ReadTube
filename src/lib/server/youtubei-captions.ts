import { fetch as undiciFetch, ProxyAgent } from "undici";
import { Innertube } from "youtubei.js";
import { thumbnailUrl } from "../youtube.ts";
import {
  finalizeCaptions,
  isAsrTrack,
  isEnglishLang,
  parseCaptionBody,
  requiresPoToken,
  resolveYouTubeProxyUrl,
  rewriteTimedTextUrl,
  selectCaptionTrack,
  type CaptionSegment,
  type FetchedMeta,
  type YouTubeContent,
} from "./youtube-fetch.ts";

const CLIENTS = ["ANDROID", "IOS"] as const;

type YoutubeiTrack = {
  base_url?: string;
  language_code?: string;
  kind?: string;
  vss_id?: string;
  is_translatable?: boolean;
  name?: { text?: string };
};

type YoutubeiInfo = {
  playability_status?: { status?: string };
  basic_info?: {
    title?: string;
    author?: string;
    channel_id?: string;
    duration?: number | { seconds?: number };
    short_description?: string;
    thumbnail?: { url?: string } | { url?: string }[];
  };
  captions?: {
    caption_tracks?: YoutubeiTrack[];
  };
};

let innertubePromise: Promise<Innertube> | null = null;

function proxiedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return sendYoutubeRequest(input, init);
}

export async function bufferRequestBody(
  request: Request,
): Promise<Buffer | undefined> {
  const method = request.method || "GET";
  if (method === "GET" || method === "HEAD") return undefined;
  return Buffer.from(await request.arrayBuffer());
}

/** youtubei.js POSTs JSON. Passing Request.body (a stream) into undici
 *  throws "duplex option is required when sending a body" and the ANDROID
 *  caption-track path never runs. Buffer the body first. */
export async function sendYoutubeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input as RequestInfo, init);
  const body = await bufferRequestBody(request);
  const proxy = resolveYouTubeProxyUrl();
  const dispatcher = proxy
    ? new ProxyAgent({ uri: proxy, pipelining: 0 })
    : undefined;
  return undiciFetch(request.url, {
    method: request.method || "GET",
    headers: Object.fromEntries(request.headers.entries()),
    body,
    dispatcher,
    signal: init?.signal ?? request.signal,
  }) as unknown as Promise<Response>;
}

async function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = Innertube.create({
      lang: "en",
      location: "US",
      retrieve_player: false,
      enable_session_cache: false,
      retrieve_innertube_config: false,
      fetch: proxiedFetch as never,
    }).catch((err: unknown) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
}

export async function fetchYoutubeiContent(
  videoId: string,
): Promise<YouTubeContent | null> {
  try {
    const yt = await getInnertube();
    let bestMeta: FetchedMeta | null = null;

    for (const client of CLIENTS) {
      try {
        const info = (await Promise.race([
          yt.getBasicInfo(videoId, { client }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${client} timed out`)), 8000),
          ),
        ])) as unknown as YoutubeiInfo;
        const meta = metaFromYoutubei(videoId, info);
        if (meta.title) bestMeta = meta;

        const tracks = (info.captions?.caption_tracks ?? [])
          .map(mapTrack)
          .filter((t) => t.baseUrl);
        console.info("[readtube] youtubei tracks", {
          videoId,
          client,
          status: info.playability_status?.status ?? null,
          trackCount: tracks.length,
          langs: tracks.map((t) => t.languageCode),
        });
        const withoutPot = tracks.filter((t) => !requiresPoToken(t.baseUrl));
        const pool = withoutPot.length ? withoutPot : tracks;
        const selected = selectCaptionTrack(pool);
        if (!selected?.track.baseUrl) continue;

        const translateTo =
          selected.translateTo ??
          (isEnglishLang(selected.track.languageCode) ? undefined : "en");
        const parsed =
          (await downloadCaptions(selected.track.baseUrl, translateTo)) ??
          (translateTo
            ? await downloadCaptions(selected.track.baseUrl)
            : null);
        if (!parsed?.segments.length) continue;

        const language =
          translateTo ?? selected.track.languageCode ?? "en";
        const asr = isAsrTrack(selected.track) || Boolean(translateTo);
        const captions = finalizeCaptions(
          parsed,
          language,
          asr ? "youtube-asr" : "youtube",
        );
        console.info("[readtube] youtubei captions", {
          videoId,
          client,
          language: captions.language,
          words: captions.text.split(/\s+/).filter(Boolean).length,
        });
        return { meta, captions };
      } catch (err) {
        console.info(
          "[readtube] youtubei client failed",
          client,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return bestMeta ? { meta: bestMeta, captions: null } : null;
  } catch (err) {
    console.info(
      "[readtube] youtubei unavailable",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function mapTrack(track: YoutubeiTrack) {
  return {
    baseUrl: track.base_url,
    languageCode: track.language_code,
    kind: track.kind,
    vssId: track.vss_id,
    isTranslatable: track.is_translatable,
    name: track.name?.text ? { simpleText: track.name.text } : undefined,
  };
}

function metaFromYoutubei(videoId: string, info: YoutubeiInfo): FetchedMeta {
  const basic = info.basic_info;
  const durationRaw = basic?.duration;
  const durationSeconds =
    typeof durationRaw === "number"
      ? durationRaw
      : Number(durationRaw?.seconds) || 0;
  const thumb = basic?.thumbnail;
  const thumbUrl = Array.isArray(thumb) ? thumb[0]?.url : thumb?.url;
  const channelId = basic?.channel_id;
  return {
    id: videoId,
    title: basic?.title || `YouTube video ${videoId}`,
    channelName: basic?.author || "YouTube",
    channelUrl: channelId
      ? `https://www.youtube.com/channel/${channelId}`
      : "https://www.youtube.com",
    thumbnailUrl: thumbUrl || thumbnailUrl(videoId),
    durationSeconds,
    description: basic?.short_description || "",
  };
}

async function downloadCaptions(
  baseUrl: string,
  tlang?: string,
): Promise<{ text: string; segments: CaptionSegment[] } | null> {
  const candidates = [
    rewriteTimedTextUrl(baseUrl, "json3", tlang),
    rewriteTimedTextUrl(baseUrl, "srv3", tlang),
    rewriteTimedTextUrl(baseUrl, "vtt", tlang),
    rewriteTimedTextUrl(baseUrl, null, tlang),
    baseUrl,
  ];
  const seen = new Set<string>();
  const proxy = resolveYouTubeProxyUrl();
  const dispatcher = proxy
    ? new ProxyAgent({ uri: proxy, pipelining: 0 })
    : undefined;

  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const res = await undiciFetch(url, {
        dispatcher,
        headers: {
          "User-Agent":
            "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: "*/*",
          Referer: "https://www.youtube.com/",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const body = await res.text();
      const parsed = parseCaptionBody(body);
      if (parsed?.segments.length) return parsed;
    } catch {
      continue;
    }
  }
  return null;
}
