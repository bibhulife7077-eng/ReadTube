// @ts-check
/**
 * Ordering for sign-in in `src/lib/auth/client.ts` and the login page.
 *
 * The popup must open on the click, before any await, or the browser drops it.
 * A prior-session clear must not stall Google, and it must finish before the
 * new token is stored so the clear cannot wipe the session just created.
 */

/** How long a pre-sign-in clear may block the Google redirect. */
export const PRE_SIGN_IN_CLEAR_TIMEOUT_MS = 400;

/**
 * @typedef {object} ProviderSignInSteps
 * @property {boolean} livePreview
 * @property {() => Window | null} openPopup Sync. Called only in the live preview.
 * @property {(timeoutMs: number) => Promise<void>} clearPrevious
 * @property {() => Promise<{ url?: string, error?: string }>} startOAuth
 * @property {(popup: Window | null) => Promise<string | null>} waitForPopup
 * @property {(token: string) => void} storeToken
 * @property {() => Promise<void>} refreshSession
 * @property {(url: string) => void} navigate
 * @property {string} callbackURL Absolute URL to return to, if it differs from the current page.
 * @property {string} currentURL
 */

/**
 * @param {ProviderSignInSteps} steps
 * @returns {Promise<void>}
 */
export async function orchestrateProviderSignIn(steps) {
  const popup = steps.livePreview ? steps.openPopup() : null;
  const clear = steps.clearPrevious(PRE_SIGN_IN_CLEAR_TIMEOUT_MS);

  if (steps.livePreview) {
    if (!popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in");
    const token = await steps.waitForPopup(popup);
    await clear;
    if (!token) throw new Error("Sign-in was cancelled or failed");
    steps.storeToken(token);
    await steps.refreshSession();
    const target = sameOriginCallback(steps.callbackURL, steps.currentURL);
    if (target !== steps.currentURL) steps.navigate(target);
    return;
  }

  await clear;
  const result = await steps.startOAuth();
  if (result.error) throw new Error(result.error);
  if (result.url) steps.navigate(result.url);
}

/**
 * Open the preview popup in the same turn as the click, then arm the
 * session hand-off. Nothing here awaits.
 *
 * @param {{
 *   openPopup: () => Window | null,
 *   startClear: () => Promise<void>,
 *   arm: (pending: { clear: Promise<void> }) => void,
 * }} steps
 * @returns {Window}
 */
export function beginPreviewSignInClick(steps) {
  const popup = steps.openPopup();
  if (!popup) throw new Error("Pop-up blocked — allow pop-ups for sign-in");
  const clear = steps.startClear();
  steps.arm({ clear });
  return popup;
}

/**
 * Stay on this origin. A `next` value must not be able to send the browser away.
 * @param {string} callbackURL
 * @param {string} currentURL
 * @returns {string}
 */
export function sameOriginCallback(callbackURL, currentURL) {
  let here;
  try {
    here = new URL(currentURL);
  } catch {
    return "/";
  }
  try {
    const next = new URL(callbackURL, here);
    if (next.origin !== here.origin) return `${here.origin}/`;
    return next.href;
  } catch {
    return `${here.origin}/`;
  }
}

/**
 * @typedef {object} ArmedPopupSteps
 * @property {string | null} token
 * @property {string} [error]
 * @property {unknown} [account] Profile already known from the popup, if any.
 * @property {(account: unknown) => void} [showAccount] Sync. Runs before the clear await.
 * @property {() => Promise<void>} clearPrevious Already started; must not be re-fired.
 * @property {(token: string) => void} storeToken
 * @property {() => Promise<void>} refreshSession Must not block the account chip or navigation.
 * @property {(url: string) => void} navigate
 * @property {string} callbackURL
 * @property {string} currentURL
 */

/**
 * Paint the signed-in account before any await, then store the token only
 * after the pre-sign-in clear has finished so that clear cannot wipe it.
 * Navigation is not held behind a profile refetch.
 * @param {ArmedPopupSteps} steps
 * @returns {Promise<void>}
 */
export async function settleArmedPopupSignIn(steps) {
  if (!steps.token) {
    throw new Error(steps.error || "Sign-in was cancelled or failed");
  }
  if (steps.showAccount) steps.showAccount(steps.account ?? null);
  await steps.clearPrevious();
  steps.storeToken(steps.token);
  const target = sameOriginCallback(steps.callbackURL, steps.currentURL);
  if (target !== steps.currentURL) steps.navigate(target);
  void Promise.resolve(steps.refreshSession()).catch(() => undefined);
}
