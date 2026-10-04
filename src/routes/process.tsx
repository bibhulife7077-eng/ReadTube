import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { processVideo } from "@/lib/api";
import { parseYouTubeId, thumbnailUrl } from "@/lib/youtube";
import { cn } from "@/lib/utils";

const STEPS = ["Fetching the transcript…", "Cleaning the transcript…", "Saving the transcript…"];

type ProcessResult = { ok: true; videoId: string } | { ok: false; error: string };

const inflight = new Map<string, Promise<ProcessResult>>();

function requestTranscript(url: string): Promise<ProcessResult> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const job = processVideo({ data: { url } }).finally(() => {
    if (inflight.get(url) === job) inflight.delete(url);
  });
  inflight.set(url, job);
  return job;
}

function reasonForUrl(url: string): string | null {
  if (!url.trim()) return "Paste a YouTube URL.";
  if (!parseYouTubeId(url)) return "That does not look like a YouTube URL.";
  return null;
}

export const Route = createFileRoute("/process")({
  validateSearch: (search: Record<string, unknown>) => ({
    url: typeof search.url === "string" ? search.url : "",
  }),
  component: ProcessPage,
});

function ProcessPage() {
  const { url } = Route.useSearch();
  const navigate = useNavigate();
  const videoId = useMemo(() => parseYouTubeId(url), [url]);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(() => reasonForUrl(url));
  const [attempt, setAttempt] = useState(0);
  const retrying = useRef(false);

  useEffect(() => {
    if (!videoId) {
      setError(reasonForUrl(url));
      return;
    }

    let cancelled = false;
    let visual = 0;
    setError(null);
    setStep(0);
    const tick = window.setInterval(() => {
      visual = Math.min(visual + 1, STEPS.length - 1);
      if (!cancelled) setStep(visual);
    }, 1400);

    requestTranscript(url)
      .then(async (result) => {
        if (cancelled) return;
        window.clearInterval(tick);
        retrying.current = false;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setStep(STEPS.length - 1);
        if (!cancelled) {
          void navigate({
            to: "/read/$videoId",
            params: { videoId: result.videoId },
          });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        window.clearInterval(tick);
        retrying.current = false;
        setError(err instanceof Error ? err.message : "Processing failed.");
      });

    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [url, videoId, navigate, attempt]);

  const failed = Boolean(error);

  return (
    <AppShell solidHeader>
      <main className="mx-auto flex w-full max-w-lg flex-col px-4 py-12 sm:py-16">
        {videoId ? (
          <div className="overflow-hidden rounded-2xl bg-elevated shadow-[var(--shadow-border)]">
            <img
              src={thumbnailUrl(videoId)}
              alt=""
              className="aspect-video w-full object-cover"
            />
          </div>
        ) : null}

        <h1 className="mt-8 font-display text-3xl tracking-tight" aria-live="polite">
          {failed ? error : STEPS[step]}
        </h1>
        {failed ? null : (
          <p className="mt-2 text-sm leading-6 text-muted">
            Fetching the video transcript. If this video has no captions, generation stops.
          </p>
        )}

        {error ? (
          <div className="mt-8 flex flex-wrap gap-3">
            {videoId ? (
              <Button
                type="button"
                onClick={() => {
                  if (retrying.current) return;
                  retrying.current = true;
                  setAttempt((n) => n + 1);
                }}
              >
                Retry
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigate({ to: "/" })}
            >
              Back
            </Button>
          </div>
        ) : (
          <>
            <WaitingShow />
            <ol className="mt-8 space-y-2">
            {STEPS.map((label, i) => {
              const state = i < step ? "done" : i === step ? "active" : "wait";
              return (
                <li
                  key={label}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm",
                    state === "active" && "bg-elevated",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 place-items-center rounded-full border text-[10px] tabular-nums",
                      state === "done" &&
                        "border-success/40 bg-success/15 text-success",
                      state === "active" &&
                        "border-accent/40 bg-accent text-accent-fg",
                      state === "wait" && "border-border text-faint",
                    )}
                    aria-hidden
                  >
                    {state === "done" ? (
                      <Check className="size-3" strokeWidth={3} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={cn(
                      state === "active" && "rt-shimmer font-medium text-fg",
                      state === "done" && "text-muted",
                      state === "wait" && "text-faint",
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>
          </>
        )}
      </main>
    </AppShell>
  );
}

const JOKES = [
  "The video is clearing its throat…",
  "Folding the ums into the margins…",
  "Teaching the captions to sit in rows…",
  "One more “so basically”…",
  "The book is winning.",
];

function WaitingShow() {
  return (
    <div className="mt-8 overflow-hidden rounded-2xl bg-elevated px-4 py-5 text-fg shadow-[var(--shadow-border)]">
      <svg viewBox="0 0 280 150" className="mx-auto h-36 w-full max-w-sm" aria-hidden="true">
        <g className="rt-drop" style={{ animationDelay: "0s" }}>
          <rect x="78" y="6" width="42" height="5" rx="2.5" fill="currentColor" opacity="0.45" />
        </g>
        <g className="rt-drop" style={{ animationDelay: "0.55s" }}>
          <rect x="118" y="0" width="28" height="5" rx="2.5" fill="currentColor" opacity="0.35" />
        </g>
        <g className="rt-drop" style={{ animationDelay: "1.1s" }}>
          <rect x="96" y="10" width="54" height="5" rx="2.5" fill="currentColor" opacity="0.4" />
        </g>

        <g className="rt-page">
          <path d="M28 58h104c6 18 8 46 4 74H36c-6-20-8-48-8-74z" fill="var(--color-paper)" stroke="var(--color-border-strong)" />
          <rect x="46" y="78" width="62" height="4" rx="2" fill="currentColor" opacity="0.28" />
          <rect x="46" y="90" width="48" height="4" rx="2" fill="currentColor" opacity="0.2" />
          <rect x="46" y="102" width="56" height="4" rx="2" fill="currentColor" opacity="0.16" />
        </g>
        <path d="M148 58h104c-6 18-8 46-4 74h-92c6-20 8-48 8-74z" fill="var(--color-bg)" stroke="var(--color-border-strong)" />
        <rect x="168" y="78" width="58" height="4" rx="2" fill="currentColor" opacity="0.22" />
        <rect x="168" y="90" width="40" height="4" rx="2" fill="currentColor" opacity="0.14" />
        <path d="M140 54v82" stroke="currentColor" strokeWidth="3" opacity="0.35" />

        <g className="rt-hop">
          <circle cx="196" cy="40" r="16" fill="var(--color-accent)" />
          <g className="rt-blink" fill="var(--color-accent-fg)">
            <circle cx="190" cy="38" r="1.6" />
            <circle cx="202" cy="38" r="1.6" />
          </g>
          <path d="M190 45c2.2 2.4 5 3.4 8 3.2" fill="none" stroke="var(--color-accent-fg)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M214 34l10 6-10 6z" fill="var(--color-accent)" />
        </g>
      </svg>
      <div className="rt-jokes mt-1 text-center text-sm text-muted">
        {JOKES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}
