import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sessionNeedsYtDlpFallback,
  ytdlpProductionBlocked,
} from "./ytdlp.ts";

describe("sessionNeedsYtDlpFallback", () => {
  it("runs on LOGIN_REQUIRED even with tracks", () => {
    assert.equal(
      sessionNeedsYtDlpFallback({
        tracks: [{ baseUrl: "https://example" }],
        player: { playabilityStatus: { status: "LOGIN_REQUIRED" } },
      }),
      true,
    );
  });

  it("runs on UNPLAYABLE", () => {
    assert.equal(
      sessionNeedsYtDlpFallback({
        tracks: [],
        player: { playabilityStatus: { status: "UNPLAYABLE" } },
      }),
      true,
    );
  });

  it("runs on 0 caption tracks", () => {
    assert.equal(
      sessionNeedsYtDlpFallback({
        tracks: [],
        player: { playabilityStatus: { status: "OK" } },
      }),
      true,
    );
  });

  it("skips when player is OK with tracks", () => {
    assert.equal(
      sessionNeedsYtDlpFallback({
        tracks: [{ baseUrl: "https://example" }],
        player: { playabilityStatus: { status: "OK" } },
      }),
      false,
    );
  });
});

describe("ytdlp production runtime", () => {
  it("is not a Vercel function in this preview process", () => {
    assert.equal(ytdlpProductionBlocked(), false);
    assert.equal(Boolean(process.env.VERCEL), false);
  });
});
