import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanTranscriptText,
  decodeCaption,
  isAsrTrack,
  isEnglishLang,
  isStubPlayer,
  mergeAsrWindows,
  parseCaptionBody,
  parseJson3,
  parseSrv3,
  parseVtt,
  reconstructSentences,
  requiresPoToken,
  rewriteTimedTextUrl,
  selectCaptionTrack,
  transcriptPassesGate,
  transcriptWordThreshold,
  webshareRotatingUrl,
  youtubeProxyConfigured,
} from "./youtube-fetch.ts";

describe("decodeCaption", () => {
  it("decodes real HTML entities", () => {
    const amp = "&" + "amp;";
    const lt = "&" + "lt;";
    const gt = "&" + "gt;";
    const quot = "&" + "quot;";
    const nbsp = "&" + "nbsp;";
    const num = "&#" + "39;";
    assert.equal(decodeCaption(`I${amp}#39;m here`), "I'm here");
    assert.equal(decodeCaption(`a ${amp} b`), "a & b");
    assert.equal(decodeCaption(`${lt}tag${gt} ${quot}q${quot}`), '<tag> "q"');
    assert.equal(decodeCaption(`it${num}s`), "it's");
    assert.equal(decodeCaption(`foo${nbsp}bar`), "foo bar");
  });

  it("strips nested ASR s tags", () => {
    assert.equal(
      decodeCaption('<s ac="0">Hello</s><s t="160"> world</s>'),
      "Hello world",
    );
  });
});

describe("parseJson3", () => {
  it("joins segs and skips window-only events", () => {
    const raw = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000 },
        {
          tStartMs: 120,
          segs: [{ utf8: "Hello " }, { utf8: "world" }],
        },
        { tStartMs: 900, segs: [{ utf8: "\n" }] },
        { tStartMs: 1400, segs: [{ utf8: "This is ASR." }] },
      ],
    });
    const parsed = parseJson3(raw);
    assert.ok(parsed);
    assert.equal(parsed.segments.length, 2);
    assert.equal(parsed.segments[0].text, "Hello world");
    assert.equal(parsed.segments[0].startSeconds, 0.12);
    assert.equal(parsed.segments[1].text, "This is ASR.");
  });
});

describe("parseSrv3", () => {
  it("reads paragraph and legacy text nodes", () => {
    const xml = `<timedtext format="3"><body>
      <p t="0" d="1000"/>
      <p t="840" d="2000"><s>Hello</s><s t="200"> there</s></p>
    </body></timedtext>`;
    const parsed = parseSrv3(xml);
    assert.ok(parsed);
    assert.equal(parsed.segments.length, 1);
    assert.equal(parsed.segments[0].text, "Hello there");
    assert.equal(parsed.segments[0].startSeconds, 0.84);
  });

  it("falls back to <text start> XML", () => {
    const xml = `<transcript><text start="1.5" dur="2">Manual ${"&" + "amp;"} clean</text></transcript>`;
    const parsed = parseSrv3(xml);
    assert.ok(parsed);
    assert.equal(parsed.segments[0].text, "Manual & clean");
    assert.equal(parsed.segments[0].startSeconds, 1.5);
  });
});

describe("parseVtt", () => {
  it("parses cues and timestamps", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.500
Hello

00:00:01.500 --> 00:00:03.000
World`;
    const parsed = parseVtt(vtt);
    assert.ok(parsed);
    assert.equal(parsed.segments.length, 2);
    assert.equal(parsed.segments[1].startSeconds, 1.5);
    assert.equal(parsed.segments[1].text, "World");
  });
});

describe("parseCaptionBody", () => {
  it("routes json, vtt, and xml", () => {
    assert.ok(parseCaptionBody('{"events":[{"tStartMs":0,"segs":[{"utf8":"Hi"}]}]}'));
    assert.ok(parseCaptionBody("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi"));
    assert.ok(parseCaptionBody('<p t="0">Hi</p>'));
    assert.equal(parseCaptionBody(""), null);
    assert.equal(parseCaptionBody("   "), null);
  });
});

describe("mergeAsrWindows", () => {
  it("drops overlapping rolling captions", () => {
    const merged = mergeAsrWindows([
      { startSeconds: 0, text: "hello world this" },
      { startSeconds: 1, text: "world this is a" },
      { startSeconds: 2, text: "this is a test" },
    ]);
    assert.deepEqual(
      merged.map((s) => s.text),
      ["hello world this", "is a", "test"],
    );
  });
});

describe("reconstructSentences", () => {
  it("joins fragments until punctuation", () => {
    const out = reconstructSentences([
      { startSeconds: 0, text: "This is" },
      { startSeconds: 1, text: "a complete sentence." },
      { startSeconds: 3, text: "Next" },
      { startSeconds: 4, text: "thought arrives." },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].text, "This is a complete sentence.");
    assert.equal(out[1].text, "Next thought arrives.");
  });
});

describe("selectCaptionTrack", () => {
  const tracks = [
    { languageCode: "es", kind: "asr", vssId: "a.es", baseUrl: "https://t/es", isTranslatable: true },
    { languageCode: "en", kind: "asr", vssId: "a.en", baseUrl: "https://t/asr" },
    { languageCode: "en", vssId: ".en", baseUrl: "https://t/manual" },
  ];

  it("prefers manual English over ASR English", () => {
    const pick = selectCaptionTrack(tracks);
    assert.equal(pick?.track.baseUrl, "https://t/manual");
    assert.equal(pick?.translateTo, undefined);
  });

  it("falls back to ASR English", () => {
    const pick = selectCaptionTrack(tracks.filter((t) => t.kind === "asr" || t.languageCode === "es"));
    assert.equal(pick?.track.baseUrl, "https://t/asr");
  });

  it("uses tlang=en on translatable non-English tracks", () => {
    const pick = selectCaptionTrack([
      { languageCode: "ja", kind: "asr", vssId: "a.ja", baseUrl: "https://t/ja", isTranslatable: true },
    ]);
    assert.equal(pick?.track.baseUrl, "https://t/ja");
    assert.equal(pick?.translateTo, "en");
  });

  it("still requests English translation when the only track is non-English", () => {
    const pick = selectCaptionTrack([
      { languageCode: "ko", kind: "asr", vssId: "a.ko", baseUrl: "https://t/ko" },
    ]);
    assert.equal(pick?.track.baseUrl, "https://t/ko");
    assert.equal(pick?.translateTo, "en");
  });
});

describe("rewriteTimedTextUrl", () => {
  it("replaces an existing fmt instead of appending", () => {
    const url = rewriteTimedTextUrl(
      "https://www.youtube.com/api/timedtext?v=abc&fmt=srv3&lang=en",
      "json3",
    );
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("fmt"), "json3");
    assert.equal(parsed.searchParams.getAll("fmt").length, 1);
  });

  it("adds tlang for translation", () => {
    const url = rewriteTimedTextUrl("https://www.youtube.com/api/timedtext?v=abc", "json3", "en");
    assert.equal(new URL(url).searchParams.get("tlang"), "en");
  });
});

describe("isStubPlayer / asr helpers", () => {
  it("treats LOGIN_REQUIRED without tracks as a stub", () => {
    assert.equal(
      isStubPlayer({ playabilityStatus: { status: "LOGIN_REQUIRED" } }),
      true,
    );
    assert.equal(
      isStubPlayer({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "https://t", languageCode: "en" }],
          },
        },
      }),
      false,
    );
  });

  it("detects ASR tracks by kind, vssId, and name", () => {
    assert.equal(isAsrTrack({ kind: "asr" }), true);
    assert.equal(isAsrTrack({ vssId: "a.en" }), true);
    assert.equal(isAsrTrack({ name: { simpleText: "English (auto-generated)" } }), true);
    assert.equal(isAsrTrack({ vssId: ".en" }), false);
    assert.equal(isEnglishLang("en-US"), true);
    assert.equal(isEnglishLang("fr"), false);
    assert.equal(
      requiresPoToken("https://www.youtube.com/api/timedtext?v=a&exp=xpe&lang=en"),
      true,
    );
    assert.equal(
      requiresPoToken("https://www.youtube.com/api/timedtext?v=a&lang=en"),
      false,
    );
  });
});

describe("transcript gate and cleaning", () => {
  it("scales the word floor for short videos", () => {
    assert.equal(transcriptWordThreshold(10), 25);
    assert.equal(transcriptWordThreshold(20), 25);
    assert.equal(transcriptWordThreshold(60), 72);
    assert.equal(transcriptWordThreshold(120), 80);
    assert.equal(transcriptWordThreshold(0), 40);
  });

  it("lets a short ASR clip pass when it would fail the old 80-word gate", () => {
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    assert.equal(transcriptPassesGate(words, 15), true);
    assert.equal(transcriptPassesGate(words, 600), false);
  });

  it("strips filler and duplicate sentences", () => {
    const cleaned = cleanTranscriptText(
      "Um hello there. Um hello there. [Music] This is fine.",
    );
    assert.equal(cleaned.includes("Um"), false);
    assert.equal(cleaned.includes("[Music]"), false);
    assert.equal((cleaned.match(/hello there/gi) ?? []).length, 1);
  });
});

describe("youtube proxy config", () => {
  it("builds a rotating Webshare URL", () => {
    assert.equal(
      webshareRotatingUrl("myuser", "s3cret"),
      "http://myuser-rotate:s3cret@p.webshare.io:80/",
    );
    assert.equal(
      webshareRotatingUrl("myuser-rotate", "s3cret"),
      "http://myuser-rotate:s3cret@p.webshare.io:80/",
    );
  });

  it("is off when no proxy env is set", () => {
    assert.equal(youtubeProxyConfigured(), false);
  });
});
