import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLikelyYouTubeUrl, parseYouTubeId } from "./youtube.ts";

const ID = "zGjDLSAMgYg";

describe("parseYouTubeId", () => {
  it("accepts share links, including text pasted around them", () => {
    const samples = [
      `https://youtu.be/${ID}?si=xlbkjw2u5j-18l2W`,
      `https://www.youtube.com/watch?v=${ID}&si=xlbkjw2u5j-18l2W`,
      `https://youtube.com/shorts/${ID}?si=xlbkjw2u5j-18l2W`,
      `https://m.youtube.com/watch?v=${ID}`,
      `youtu.be/${ID}?si=xlbkjw2u5j-18l2W`,
      `How to hack your brain https://youtu.be/${ID}?si=xlbkjw2u5j-18l2W`,
      `Title here\nhttps://youtu.be/${ID}?si=xlbkjw2u5j-18l2W`,
      `https://www.youtube.com/live/${ID}?si=xlbkjw2u5j-18l2W`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/attribution_link?a=abc&u=%2Fwatch%3Fv%3D${ID}%26feature%3Dshare`,
      ` ${ID} `,
    ];
    for (const sample of samples) {
      assert.equal(parseYouTubeId(sample), ID, sample);
      assert.equal(isLikelyYouTubeUrl(sample), true, sample);
    }
  });

  it("rejects text that is not a video link", () => {
    assert.equal(parseYouTubeId("https://www.youtube.com/feed/subscriptions"), null);
    assert.equal(parseYouTubeId("not a link"), null);
    assert.equal(isLikelyYouTubeUrl(""), false);
  });

  it("accepts a short share link with a cut-off si param", () => {
    assert.equal(parseYouTubeId("https://youtu.be/hGl_eWHMVX4?si=Cg"), "hGl_eWHMVX4");
  });
});
