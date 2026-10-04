import { useSyncExternalStore } from "react";
import {
  readAccountStatus,
  readCachedAccount,
  subscribeAccount,
  type AccountStatus,
  type CachedAccount,
} from "@/lib/auth/session-bridge";

const signedOutOnServer = (): AccountStatus => "unknown";
const noAccountOnServer = (): CachedAccount | null => null;

/** Account chip data. Null on the server and until a profile is known. */
export function useCachedAccount(): CachedAccount | null {
  return useSyncExternalStore(subscribeAccount, readCachedAccount, noAccountOnServer);
}

/**
 * `unknown` only while a deployed cookie session might still exist.
 * Preview visitors with no token resolve to `out` immediately.
 */
export function useAccountStatus(): AccountStatus {
  return useSyncExternalStore(subscribeAccount, readAccountStatus, signedOutOnServer);
}
