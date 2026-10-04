import type { VideoPack } from "./types";

const CAPTION_SOURCES = new Set(["youtube", "youtube-asr", "ytdlp"]);

export function isRealTranscriptPack(pack: VideoPack): boolean {
  if (pack.output.model === "scaffold" || pack.output.model === "grok-4.5-meta") {
    return false;
  }
  if (!CAPTION_SOURCES.has(pack.transcript.source)) return false;
  return pack.transcript.cleanedText.trim().length > 0;
}
