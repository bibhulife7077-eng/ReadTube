import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Clock3, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { fetchHistory, removeFromHistory } from "@/lib/api";
import { useAccountStatus } from "@/lib/use-account";
import type { HistoryItem } from "@/lib/types";
import { formatDuration, relativeTime } from "@/lib/utils";

export default function HistoryPage() {
  const status = useAccountStatus();
  if (status === "out") return <Navigate to="/login" search={{ next: "/history" }} />;
  return <HistoryList />;
}

function HistoryList() {
  const navigate = useNavigate();
  const status = useAccountStatus();
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  const reload = useCallback(() => {
    fetchHistory()
      .then(setItems)
      .catch(() => {
        // A session check can still be in flight. Don't flash an empty library.
        if (status === "in") setItems([]);
      });
  }, [status]);

  useEffect(() => {
    if (status === "out") return;
    reload();
  }, [reload, status]);

  async function remove(videoId: string) {
    setItems((prev) => prev?.filter((i) => i.videoId !== videoId) ?? prev);
    try {
      await removeFromHistory({ data: { videoId } });
    } catch {
      reload();
    }
  }

  return (
    <AppShell solidHeader>
      <main className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Library
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">History</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
          Reads you have opened while signed in. Generating without an account
          still works — it just is not stored here.
        </p>

        {items === null ? (
          <p className="mt-10 text-sm text-muted">Loading your library…</p>
        ) : items.length === 0 ? (
          <div className="mt-12 rounded-2xl bg-surface px-6 py-12 text-center shadow-[var(--shadow-border)]">
            <p className="font-display text-2xl">Nothing saved yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              Open a sample on the home page, or paste a URL. Reads you view
              while signed in appear here automatically.
            </p>
            <Button
              className="mt-6"
              type="button"
              onClick={() => void navigate({ to: "/" })}
            >
              Generate a read
            </Button>
          </div>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.videoId}>
                <article className="flex gap-4 overflow-hidden rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]">
                  <Link
                    to="/read/$videoId"
                    params={{ videoId: item.videoId }}
                    className="flex min-w-0 flex-1 gap-4 no-underline"
                  >
                    <img
                      src={item.video.thumbnailUrl}
                      alt=""
                      className="h-24 w-40 shrink-0 rounded-xl object-cover"
                    />
                    <div className="min-w-0 py-1">
                      <h2 className="line-clamp-2 text-sm font-medium leading-5 text-fg">
                        {item.video.title}
                      </h2>
                      <p className="mt-1 text-xs text-muted">
                        {item.video.channelName}
                      </p>
                      <p className="mt-2 flex items-center gap-2 text-xs text-faint">
                        <Clock3 className="size-3" />
                        {relativeTime(item.updatedAt)}
                        <span aria-hidden>·</span>
                        {formatDuration(item.video.durationSeconds)}
                      </p>
                    </div>
                  </Link>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted hover:text-danger"
                    onClick={() => void remove(item.videoId)}
                    aria-label={`Remove ${item.video.title} from history`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </article>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
