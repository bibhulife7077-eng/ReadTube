import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type {
  HistoryItem,
  ReadingMode,
  UserSettings,
  VideoMeta,
  VideoPack,
} from "@/lib/types";
import { parseYouTubeId } from "@/lib/youtube";

export const listSamples = createServerFn({ method: "GET" }).handler(
  async (): Promise<VideoMeta[]> => {
    const { SAMPLE_VIDEOS } = await import("@/lib/catalog");
    return SAMPLE_VIDEOS;
  },
);

export const getVideoPack = createServerFn({ method: "GET" })
  .validator((input: { videoId: string }) => input)
  .handler(async ({ data }): Promise<VideoPack | null> => {
    const { getPack } = await import("@/lib/server/store");
    const pack = await getPack(data.videoId);
    return pack;
  });

export const processVideo = createServerFn({ method: "POST" })
  .validator((input: { url: string }) => input)
  .handler(async ({ data }): Promise<{ ok: true; videoId: string } | { ok: false; error: string }> => {
    const id = parseYouTubeId(data.url);
    if (!id) return { ok: false, error: "That does not look like a YouTube URL." };
    try {
      const { processVideoId } = await import("@/lib/server/process");
      const pack = await processVideoId(id);
      return { ok: true, videoId: pack.video.id };
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "TranscriptUnavailableError" ||
          err.message === "No transcript available" ||
          err.message === "No transcript available for this video.")
      ) {
        return { ok: false, error: err.message || "No transcript available" };
      }
      const message = err instanceof Error ? err.message : "Processing failed.";
      return { ok: false, error: message };
    }
  });

export const fetchHistory = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<HistoryItem[]> => {
    const { listHistory } = await import("@/lib/server/store");
    return listHistory(context.userId);
  });

export const saveToHistory = createServerFn({ method: "POST" })
  .validator((input: { videoId: string; lastMode: ReadingMode }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { upsertHistory } = await import("@/lib/server/store");
    await upsertHistory(context.userId, data.videoId, data.lastMode);
    return { ok: true };
  });

export const removeFromHistory = createServerFn({ method: "POST" })
  .validator((input: { videoId: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { deleteHistory } = await import("@/lib/server/store");
    await deleteHistory(context.userId, data.videoId);
    return { ok: true };
  });

export const fetchSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<UserSettings> => {
    const { getSettings } = await import("@/lib/server/store");
    return getSettings(context.userId);
  });

export const fetchOpenPrefs = createServerFn({ method: "GET" })
  .validator((input: { videoId: string }) => input)
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
      data,
    }): Promise<{ mode: ReadingMode; settings: UserSettings }> => {
      const { getSettings, getHistoryMode } = await import("@/lib/server/store");
      const settings = await getSettings(context.userId);
      const last = await getHistoryMode(context.userId, data.videoId);
      return { mode: last ?? settings.defaultMode, settings };
    },
  );

export const updateSettings = createServerFn({ method: "POST" })
  .validator((input: UserSettings) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { saveSettings } = await import("@/lib/server/store");
    await saveSettings(context.userId, data);
    return { ok: true };
  });
