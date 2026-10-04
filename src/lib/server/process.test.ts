import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRealTranscriptPack } from "../pack.ts";
import type { VideoPack } from "../types.ts";

function pack(overrides: Partial<VideoPack> & { model?: string; source?: string; text?: string }): VideoPack {
  return {
    video: {
      id: "aaaaaaaaaaa",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      title: "t",
      channelName: "c",
      channelUrl: "https://www.youtube.com",
      thumbnailUrl: "",
      durationSeconds: 60,
      description: "",
    },
    transcript: {
      rawText: overrides.text ?? "hello world this is spoken text",
      cleanedText: overrides.text ?? "hello world this is spoken text",
      segments: [],
      language: "en",
      source: overrides.source ?? "youtube",
    },
    output: {
      quickRead: "q",
      detailedRead: "d",
      studyNotes: { overview: "", outline: [], keyTerms: [], questions: [] },
      chapters: [],
      takeaways: [],
      topics: [],
      readingTimeQuick: 1,
      readingTimeDetailed: 1,
      readingTimeNotes: 1,
      model: overrides.model ?? "grok",
    },
  };
}

describe("failed reads are not treated as cache hits", () => {
  it("rejects scaffold, empty, and non-caption packs", () => {
    assert.equal(isRealTranscriptPack(pack({ model: "scaffold", source: "youtube" })), false);
    assert.equal(isRealTranscriptPack(pack({ model: "grok-4.5-meta", source: "youtube" })), false);
    assert.equal(isRealTranscriptPack(pack({ source: "unavailable" })), false);
    assert.equal(isRealTranscriptPack(pack({ source: "assemblyai" })), false);
    assert.equal(isRealTranscriptPack(pack({ source: "gemini-video" })), false);
    assert.equal(isRealTranscriptPack(pack({ source: "whisper-large-v3-turbo" })), false);
    assert.equal(isRealTranscriptPack(pack({ text: "   ", source: "youtube" })), false);
  });

  it("accepts cleaned YouTube transcripts", () => {
    assert.equal(isRealTranscriptPack(pack({ source: "youtube" })), true);
    assert.equal(isRealTranscriptPack(pack({ source: "youtube-asr" })), true);
    assert.equal(isRealTranscriptPack(pack({ source: "ytdlp" })), true);
  });
});
