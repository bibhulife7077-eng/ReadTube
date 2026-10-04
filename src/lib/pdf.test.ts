import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTranscriptPdf, transcriptPdfFilename } from "./pdf.ts";

describe("transcript pdf", () => {
  it("names the file from the video title", () => {
    assert.equal(transcriptPdfFilename("How to Speak!"), "How-to-Speak-Transcript.pdf");
  });

  it("includes the title, channel, url, and timestamps, and paginates long transcripts", () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({
      time: `${i}:00`,
      text: `Line ${i} of the spoken transcript with enough words to wrap onto the page.`,
    }));
    const bytes = buildTranscriptPdf({
      title: "How to Speak",
      channelName: "TED",
      url: "https://www.youtube.com/watch?v=eIho2S0ZahI",
      lines,
    });
    const text = new TextDecoder().decode(bytes);
    assert.match(text, /^%PDF-1\.4/);
    assert.match(text, /How to Speak/);
    assert.match(text, /TED/);
    assert.match(text, /watch\?v=eIho2S0ZahI/);
    assert.match(text, /0:00/);
    assert.match(text, /\/Count [2-9]/);
  });
});
