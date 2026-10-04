import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspectCaptionDiscovery } from "./youtube-fetch.ts";

const CASES: {
  id: string;
  label: string;
  expect: "manual" | "asr" | "short" | "translated" | "none";
}[] = [
  { id: "aircAruvnKk", label: "Manual caption (3Blue1Brown NN)", expect: "manual" },
  { id: "CcsUYu0PVxY", label: "ASR-only English", expect: "asr" },
  { id: "jNQXAC9IVRw", label: "Short clip (Me at the zoo)", expect: "short" },
  { id: "dQw4w9WgXcQ", label: "Popular mixed tracks (manual+ASR)", expect: "manual" },
  { id: "9bZkp7q19f0", label: "Non-English original (Gangnam Style)", expect: "translated" },
];

describe("live YouTube caption coverage", { timeout: 120000 }, () => {
  for (const c of CASES) {
    it(`${c.label} [${c.id}]`, async () => {
      const result = await inspectCaptionDiscovery(c.id);
      const row = {
        id: c.id,
        expect: c.expect,
        playability: result.playability,
        stub: result.stub,
        trackCount: result.trackCount,
        selected: result.selected,
        source: result.captions?.source ?? null,
        language: result.captions?.language ?? null,
        words: result.words,
        durationSeconds: result.durationSeconds,
        passesGate: result.passesGate,
        sample: result.captions?.text.slice(0, 100) ?? "",
        tracks: result.tracks.slice(0, 10),
      };
      console.log(JSON.stringify(row, null, 2));

      if (result.trackCount === 0) {
        console.log(`NOTE ${c.id}: no captionTracks (player=${result.playability})`);
        return;
      }

      if (c.expect === "manual") {
        assert.equal(result.selected?.asr, false, "should prefer uploaded English");
      }
      if (c.expect === "asr") {
        assert.equal(result.selected?.asr, true, "should select ASR English");
      }
      if (c.expect === "short") {
        assert.ok(result.durationSeconds < 60);
        assert.ok(result.selected);
      }
      if (c.expect === "translated") {
        assert.ok(result.selected);
      }

      if (result.captions) {
        assert.ok(result.words > 0);
        assert.ok(result.passesGate);
      } else {
        console.log(`NOTE ${c.id}: tracks found but timedtext body empty (likely IP/poToken block)`);
      }
    });
  }
});
