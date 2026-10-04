import { isRealTranscriptPack } from "@/lib/pack";
import type { AiOutput, Transcript, VideoMeta, VideoPack } from "@/lib/types";
import { thumbnailUrl, watchUrl } from "@/lib/youtube";
import { getPack, savePack } from "./store";
import { fetchYouTubeContent } from "./youtube-fetch";

const CAPTION_SOURCES = new Set(["youtube", "youtube-asr", "ytdlp"]);

export class TranscriptUnavailableError extends Error {
  readonly code = "no_transcript" as const;
  constructor(message = "No transcript available for this video.") {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}

export { isRealTranscriptPack };

export async function processVideoId(videoId: string): Promise<VideoPack> {
  const existing = await getPack(videoId);
  if (isCaptionPack(existing)) return existing;

  const content = await fetchYouTubeContent(videoId);
  const captions = content.captions;
  const text = captions?.text.trim() ?? "";
  const title = (content.meta.title || "").trim();
  if (!captions || !text || (title && text.toLowerCase() === title.toLowerCase())) {
    throw new TranscriptUnavailableError(
      content.failure || "No transcript available for this video.",
    );
  }

  const transcript: Transcript = {
    rawText: text,
    cleanedText: text,
    segments: captions.segments
      .map((segment) => ({
        startSeconds: Math.max(0, segment.startSeconds),
        text: segment.text.trim(),
      }))
      .filter((segment) => segment.text),
    language: captions.language || "en",
    source: captions.source,
  };
  const video: VideoMeta = {
    id: videoId,
    url: watchUrl(videoId),
    title: content.meta.title || `YouTube video ${videoId}`,
    channelName: content.meta.channelName || "YouTube",
    channelUrl: content.meta.channelUrl || "https://www.youtube.com",
    thumbnailUrl: content.meta.thumbnailUrl || thumbnailUrl(videoId),
    durationSeconds: content.meta.durationSeconds || 0,
    description: "",
  };
  const pack: VideoPack = { video, transcript, output: emptyOutput() };
  await savePack(pack);
  return pack;
}

function isCaptionPack(pack: VideoPack | null): pack is VideoPack {
  if (!pack) return false;
  if (!CAPTION_SOURCES.has(pack.transcript.source)) return false;
  return pack.transcript.cleanedText.trim().length > 0;
}

function emptyOutput(): AiOutput {
  return {
    quickRead: "",
    detailedRead: "",
    studyNotes: { overview: "", outline: [], keyTerms: [], questions: [] },
    chapters: [],
    takeaways: [],
    topics: [],
    readingTimeQuick: 0,
    readingTimeDetailed: 0,
    readingTimeNotes: 0,
    model: "transcript",
  };
}
