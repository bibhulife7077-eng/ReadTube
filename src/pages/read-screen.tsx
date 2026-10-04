import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, Check, Copy, Download, ExternalLink } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { applyFontSize, applyTheme } from "@/components/theme";
import { Button } from "@/components/ui/button";
import { fetchOpenPrefs, getVideoPack, saveToHistory } from "@/lib/api";
import { readAccountStatus } from "@/lib/auth/session-bridge";
import { downloadTranscriptPdf } from "@/lib/pdf";
import { useAccountStatus } from "@/lib/use-account";
import type { Transcript, VideoPack } from "@/lib/types";
import { formatDuration, formatTimestamp } from "@/lib/utils";
import { Route } from "@/routes/read.$videoId";

export default function TranscriptPage() {
  const { videoId } = Route.useParams();
  const [pack, setPack] = useState<VideoPack | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getVideoPack({ data: { videoId } })
      .then((row) => {
        if (!cancelled) setPack(row);
      })
      .catch(() => {
        if (!cancelled) setPack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (pack === undefined) {
    return (
      <AppShell solidHeader>
        <main className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <div className="min-h-40 border-b border-border py-4">
            <div className="h-3 w-24 rounded bg-elevated" />
            <div className="mt-3 h-8 w-4/5 max-w-md rounded bg-elevated" />
            <p className="mt-4 text-sm text-muted">Opening transcript…</p>
          </div>
        </main>
      </AppShell>
    );
  }

  if (!pack) {
    return (
      <AppShell solidHeader>
        <main className="mx-auto max-w-lg px-4 py-16">
          <h1 className="font-display text-3xl">Transcript not found</h1>
          <p className="mt-2 text-sm text-muted">
            This video has not been transcribed yet, or the id is invalid.
          </p>
          <Button asChild className="mt-6">
            <Link to="/">Get a transcript</Link>
          </Button>
        </main>
      </AppShell>
    );
  }

  return <TranscriptView pack={pack} />;
}

function TranscriptView({ pack }: { pack: VideoPack }) {
  const status = useAccountStatus();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const copying = useRef(false);
  const downloading = useRef(false);

  useEffect(() => {
    if (status !== "in") return;
    let cancelled = false;
    fetchOpenPrefs({ data: { videoId: pack.video.id } })
      .then((prefs) => {
        if (cancelled) return;
        applyTheme(prefs.settings.theme);
        applyFontSize(prefs.settings.fontSize);
      })
      .catch(() => undefined);
    void saveToHistory({ data: { videoId: pack.video.id, lastMode: "transcript" } })
      .then(() => {
        if (!cancelled) setSaved(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [status, pack.video.id]);

  const body =
    pack.transcript.segments.map((segment) => segment.text).join("\n") ||
    pack.transcript.cleanedText;

  async function onCopy() {
    if (copying.current) return;
    copying.current = true;
    const text = pack.transcript.segments.length
      ? pack.transcript.segments
          .map((segment) => `${formatTimestamp(segment.startSeconds)}  ${segment.text}`)
          .join("\n")
      : body;
    const payload = `${pack.video.title}\n${pack.video.channelName}\n${pack.video.url}\n\n${text}`;
    try {
      await copyText(payload);
      setCopied(true);
      toast.success("Transcript copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy");
    } finally {
      window.setTimeout(() => {
        copying.current = false;
      }, 400);
    }
  }

  function onDownload() {
    if (downloading.current) return;
    downloading.current = true;
    try {
      downloadTranscriptPdf({
        title: pack.video.title,
        channelName: pack.video.channelName,
        url: pack.video.url,
        segments: pack.transcript.segments,
        fallbackText: pack.transcript.cleanedText,
      });
      toast.success("PDF ready");
    } catch {
      toast.error("Could not download the PDF");
    } finally {
      window.setTimeout(() => {
        downloading.current = false;
      }, 800);
    }
  }

  async function onSave() {
    if (saving) return;
    if (readAccountStatus() === "out") {
      void navigate({ to: "/login", search: { next: `/read/${pack.video.id}` } });
      return;
    }
    setSaving(true);
    try {
      await saveToHistory({ data: { videoId: pack.video.id, lastMode: "transcript" } });
      setSaved(true);
      toast.success("Saved to history");
    } catch {
      if (readAccountStatus() !== "in") {
        void navigate({ to: "/login", search: { next: `/read/${pack.video.id}` } });
        return;
      }
      toast.error("Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell solidHeader>
      <article className="mx-auto w-full max-w-3xl px-4 pb-20 sm:px-6">
        <header className="sticky top-0 z-20 -mx-4 border-b border-border bg-bg px-4 py-4 sm:-mx-6 sm:px-6">
          <p className="truncate text-xs text-muted">{pack.video.channelName}</p>
          <h1 className="mt-1 line-clamp-2 font-display text-2xl leading-tight tracking-tight sm:text-3xl">
            {pack.video.title}
          </h1>
          <p className="mt-2 text-xs text-muted">
            <span className="tabular-nums">{formatDuration(pack.video.durationSeconds)}</span>
            <span aria-hidden> · </span>
            <span>Transcript · {pack.transcript.language}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => void onCopy()}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-11" disabled={saving} onClick={() => void onSave()}>
              <Bookmark className="size-4" />
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </Button>
            <Button type="button" variant="secondary" className="min-h-11" onClick={onDownload}>
              <Download className="size-4" />
              Download PDF
            </Button>
            <Button type="button" variant="ghost" className="min-h-11" asChild>
              <a href={pack.video.url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Source
              </a>
            </Button>
          </div>
        </header>

        <TranscriptLines segments={pack.transcript.segments} fallback={pack.transcript.cleanedText} />
      </article>
    </AppShell>
  );
}

const TranscriptLines = memo(function TranscriptLines({
  segments,
  fallback,
}: {
  segments: Transcript["segments"];
  fallback: string;
}) {
  return (
    <div className="reader-body mt-8">
      {segments.length > 0 ? (
        <ol className="space-y-1">
          {segments.map((segment, index) => (
            <li
              key={`${segment.startSeconds}-${index}`}
              className="flex gap-4 rounded-xl px-2 py-2"
            >
              <span className="w-12 shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-faint">
                {formatTimestamp(segment.startSeconds)}
              </span>
              <p className="font-serif text-[1.05rem] leading-7 text-fg/90">{segment.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="font-serif text-[1.075rem] leading-[1.75] text-fg/90">{fallback}</p>
      )}
    </div>
  );
});

async function copyText(text: string): Promise<void> {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "1px";
  area.style.height = "1px";
  area.style.fontSize = "16px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus({ preventScroll: true });
  area.select();
  area.setSelectionRange(0, area.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  if (copied) return;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("copy failed");
}
