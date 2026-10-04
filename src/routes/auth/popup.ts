import { createFileRoute } from "@tanstack/react-router";

/** First-party OAuth popup. No page shell — the handler is the whole response. */
export const Route = createFileRoute("/auth/popup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleAuthPopupRequest } = await import("@/lib/auth/popup.server");
        return handleAuthPopupRequest(request);
      },
      POST: async ({ request }) => {
        const { handleAuthPopupRequest } = await import("@/lib/auth/popup.server");
        return handleAuthPopupRequest(request);
      },
    },
  },
});
