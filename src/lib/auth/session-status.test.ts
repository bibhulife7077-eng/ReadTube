import assert from "node:assert/strict";
import { test } from "node:test";
import { accountStatusFrom, sessionWriteDecision, shouldKeepFreshAccount } from "./session-bridge.ts";

test("a cached account is signed in before the network check", () => {
  assert.equal(
    accountStatusFrom({
      checked: "unknown",
      hasAccount: true,
      hasBearer: false,
      livePreview: true,
    }),
    "in",
  );
});

test("preview with nothing stored is signed out immediately", () => {
  assert.equal(
    accountStatusFrom({
      checked: "unknown",
      hasAccount: false,
      hasBearer: false,
      livePreview: true,
    }),
    "out",
  );
});

test("deployed cookie sessions stay unknown until the server answers", () => {
  assert.equal(
    accountStatusFrom({
      checked: "unknown",
      hasAccount: false,
      hasBearer: false,
      livePreview: false,
    }),
    "unknown",
  );
});

test("a stored profile stays signed in even if an older check said out", () => {
  assert.equal(
    accountStatusFrom({
      checked: "out",
      hasAccount: true,
      hasBearer: false,
      livePreview: false,
    }),
    "in",
  );
});

test("sign-out with nothing stored stays signed out", () => {
  assert.equal(
    accountStatusFrom({
      checked: "out",
      hasAccount: false,
      hasBearer: false,
      livePreview: true,
    }),
    "out",
  );
});

test("a fresh login is not cleared by a null session that is already in flight", () => {
  assert.equal(
    sessionWriteDecision({ ticket: 1, epoch: 2, protectUntil: 0, now: 5000, outcome: "none" }),
    "ignore",
  );
  assert.equal(
    sessionWriteDecision({ ticket: 2, epoch: 2, protectUntil: 9000, now: 5000, outcome: "none" }),
    "ignore",
  );
});

test("a dead session clears only after the fresh-login window", () => {
  assert.equal(
    sessionWriteDecision({ ticket: 2, epoch: 2, protectUntil: 1000, now: 5000, outcome: "none" }),
    "clear",
  );
  assert.equal(
    sessionWriteDecision({ ticket: 2, epoch: 2, protectUntil: 0, now: 5000, outcome: "user" }),
    "apply",
  );
  assert.equal(
    sessionWriteDecision({ ticket: 2, epoch: 2, protectUntil: 0, now: 5000, outcome: "error" }),
    "ignore",
  );
});

test("a login painted in the last few seconds is not treated as signed out", () => {
  const now = 10_000;
  assert.equal(shouldKeepFreshAccount(9_500, now), true);
  assert.equal(shouldKeepFreshAccount(0, now), false);
  assert.equal(shouldKeepFreshAccount(now - 21_000, now), false);
});
