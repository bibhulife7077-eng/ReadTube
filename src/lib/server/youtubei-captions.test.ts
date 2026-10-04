import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bufferRequestBody } from "./youtubei-captions.ts";

describe("bufferRequestBody", () => {
  it("turns a JSON POST stream into a Buffer so undici does not need duplex", async () => {
    const request = new Request("https://www.youtube.com/youtubei/v1/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID" } } }),
    });
    const body = await bufferRequestBody(request);
    assert.ok(Buffer.isBuffer(body));
    assert.equal(
      JSON.parse(body!.toString()).context.client.clientName,
      "ANDROID",
    );
  });

  it("leaves GET bodies empty", async () => {
    const request = new Request("https://www.youtube.com/api/timedtext?v=jNQXAC9IVRw");
    assert.equal(await bufferRequestBody(request), undefined);
  });
});
