import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginPreviewSignInClick,
  orchestrateProviderSignIn,
  PRE_SIGN_IN_CLEAR_TIMEOUT_MS,
  sameOriginCallback,
  settleArmedPopupSignIn,
} from "./sign-in-plan.mjs";

test("preview opens the popup before anything async, then stores the token and refreshes", async () => {
  /** @type {string[]} */
  const order = [];
  await orchestrateProviderSignIn({
    livePreview: true,
    openPopup() {
      order.push("open");
      return /** @type {Window} */ ({});
    },
    clearPrevious() {
      order.push("clear");
      return Promise.resolve();
    },
    async startOAuth() {
      order.push("oauth");
      return {};
    },
    async waitForPopup() {
      order.push("wait");
      return "tok";
    },
    storeToken(token) {
      order.push(`store:${token}`);
    },
    async refreshSession() {
      order.push("refresh");
    },
    navigate() {
      order.push("nav");
    },
    callbackURL: "http://localhost/",
    currentURL: "http://localhost/",
  });
  assert.deepEqual(order, ["open", "clear", "wait", "store:tok", "refresh"]);
  assert.equal(PRE_SIGN_IN_CLEAR_TIMEOUT_MS < 1000, true);
});

test("preview click opens the popup before the clear is even started", () => {
  /** @type {string[]} */
  const order = [];
  const popup = beginPreviewSignInClick({
    openPopup() {
      order.push("open");
      return /** @type {Window} */ ({ closed: false });
    },
    startClear() {
      order.push("clear");
      return Promise.resolve();
    },
    arm() {
      order.push("arm");
    },
  });
  assert.equal(popup.closed, false);
  assert.deepEqual(order, ["open", "clear", "arm"]);
});

test("deployed sign-in does not start Google until the clear settles, then redirects", async () => {
  /** @type {string[]} */
  const order = [];
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const done = orchestrateProviderSignIn({
    livePreview: false,
    openPopup() {
      order.push("open");
      return null;
    },
    clearPrevious(timeoutMs) {
      order.push(`clear:${timeoutMs}`);
      return gate;
    },
    async startOAuth() {
      order.push("oauth");
      return { url: "https://accounts.google.com/o/oauth2" };
    },
    async waitForPopup() {
      return null;
    },
    storeToken() {},
    async refreshSession() {},
    navigate(url) {
      order.push(`go:${url}`);
    },
    callbackURL: "http://localhost/",
    currentURL: "http://localhost/login",
  });
  await Promise.resolve();
  assert.deepEqual(order, [`clear:${PRE_SIGN_IN_CLEAR_TIMEOUT_MS}`]);
  release();
  await done;
  assert.deepEqual(order, [
    `clear:${PRE_SIGN_IN_CLEAR_TIMEOUT_MS}`,
    "oauth",
    "go:https://accounts.google.com/o/oauth2",
  ]);
});

test("popup account is shown before the clear finishes, then we navigate without waiting on refresh", async () => {
  /** @type {string[]} */
  const order = [];
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => {
      order.push("cleared");
      resolve(undefined);
    };
  });
  const done = settleArmedPopupSignIn({
    token: "tok",
    account: { displayName: "Ada" },
    showAccount(account) {
      const name =
        account && typeof account === "object" && "displayName" in account
          ? String(account.displayName)
          : "";
      order.push(`show:${name}`);
    },
    clearPrevious() {
      order.push("wait-clear");
      return gate;
    },
    storeToken(token) {
      order.push(`store:${token}`);
    },
    async refreshSession() {
      order.push("refresh");
    },
    navigate(url) {
      order.push(`go:${url}`);
    },
    callbackURL: "/library",
    currentURL: "http://localhost/login",
  });
  await Promise.resolve();
  assert.deepEqual(order, ["show:Ada", "wait-clear"]);
  release();
  await done;
  assert.deepEqual(order, [
    "show:Ada",
    "wait-clear",
    "cleared",
    "store:tok",
    "go:http://localhost/library",
    "refresh",
  ]);
});

test("a failed popup does not paint an account", async () => {
  let shown = false;
  await assert.rejects(
    () =>
      settleArmedPopupSignIn({
        token: null,
        error: "nope",
        showAccount() {
          shown = true;
        },
        async clearPrevious() {},
        storeToken() {},
        async refreshSession() {},
        navigate() {},
        callbackURL: "/",
        currentURL: "http://localhost/login",
      }),
    /nope/,
  );
  assert.equal(shown, false);
});

test("popup sign-in refuses an off-origin return", async () => {
  let went = "";
  await settleArmedPopupSignIn({
    token: "tok",
    async clearPrevious() {},
    storeToken() {},
    async refreshSession() {},
    navigate(url) {
      went = url;
    },
    callbackURL: "https://evil.example/phish",
    currentURL: "http://localhost/login",
  });
  assert.equal(went, "http://localhost/");
  assert.equal(sameOriginCallback("https://evil.example", "http://localhost/login"), "http://localhost/");
});
