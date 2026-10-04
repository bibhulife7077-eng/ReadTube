import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readPopupHandoff,
  rememberPopupUser,
  savePopupHandoff,
  takePopupHandoff,
  userFromSessionDataCookie,
} from "./popup-handoff.ts";

test("a handoff stays readable so a later profile can replace the token-only row", () => {
  const nonce = `once-${Date.now()}`;
  assert.equal(savePopupHandoff({ nonce, token: "tok", user: null }), true);
  assert.equal(readPopupHandoff(nonce)?.token, "tok");
  assert.equal(readPopupHandoff(nonce)?.user, null);
  rememberPopupUser(nonce, { name: "Ada Lovelace", email: "ada@example.com", image: null });
  const again = readPopupHandoff(nonce);
  assert.equal(again?.token, "tok");
  assert.equal(again?.user?.name, "Ada Lovelace");
});

test("a save without a profile does not wipe a name already stored", () => {
  const nonce = `keep-${Date.now()}`;
  savePopupHandoff({
    nonce,
    token: "tok",
    user: { name: "Ada Lovelace", email: null, image: null },
  });
  savePopupHandoff({ nonce, token: "tok" });
  assert.equal(readPopupHandoff(nonce)?.user?.name, "Ada Lovelace");
});

test("empty nonce or token is rejected", () => {
  assert.equal(savePopupHandoff({ nonce: "", token: "tok" }), false);
  assert.equal(savePopupHandoff({ nonce: "abc", token: "  " }), false);
  assert.equal(readPopupHandoff(""), null);
  assert.equal(takePopupHandoff(""), null);
});

test("the compact session cookie yields a name without a database read", () => {
  const payload = {
    session: {
      user: { name: "Ada Lovelace", email: "ada@example.com", image: "https://example.com/a.png" },
    },
    expiresAt: Date.now() + 60_000,
    signature: "sig",
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const header = `__Host-grok-auth.session_data=${raw}; other=1`;
  const user = userFromSessionDataCookie(header);
  assert.equal(user?.name, "Ada Lovelace");
  assert.equal(user?.email, "ada@example.com");
  assert.equal(user?.image, "https://example.com/a.png");
  assert.equal(userFromSessionDataCookie(null), null);
  assert.equal(userFromSessionDataCookie("unrelated=1"), null);
});
