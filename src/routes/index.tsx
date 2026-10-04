import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SAMPLE_VIDEOS } from "@/lib/catalog";
import type { VideoMeta } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";
import { isLikelyYouTubeUrl, parseYouTubeId, watchUrl } from "@/lib/youtube";

/** Runs as the HTML is parsed, before the app bundle. Highlights Generate
 *  from the field itself so a paste is not waiting on hydration. */
const GENERATE_WATCH = `(function(){
  function stateOf(value){
    var v=(value||"").replace(/[\\u200B-\\u200D\\uFEFF\\u2060\\u00A0]/g,"").trim();
    if(!v) return "empty";
    if(/^[A-Za-z0-9_-]{11}$/.test(v)) return "ready";
    if(/youtu\\.be\\/[A-Za-z0-9_-]{11}/i.test(v)) return "ready";
    if(/[?&]v=[A-Za-z0-9_-]{11}/i.test(v)) return "ready";
    if(/youtube(?:-nocookie)?\\.com\\/(?:embed|shorts|live|v|e)\\/[A-Za-z0-9_-]{11}/i.test(v)) return "ready";
    if(/music\\.youtube\\.com\\/watch\\?v=[A-Za-z0-9_-]{11}/i.test(v)) return "ready";
    return "bad";
  }
  var bound=null;
  function paint(){
    var input=document.getElementById("yt-url");
    var form=document.getElementById("yt-form");
    var btn=document.getElementById("yt-generate");
    if(!input||!form||!btn) return;
    if(bound!==input){
      bound=input;
      ["input","keyup","change","compositionend","focus"].forEach(function(name){
        input.addEventListener(name,paint,true);
      });
      input.addEventListener("paste",function(){
        paint();
        [0,30,80,160,400].forEach(function(ms){setTimeout(paint,ms);});
      },true);
    }
    var state=stateOf(input.value);
    form.setAttribute("data-url-state",state);
    var ready=state==="ready";
    btn.setAttribute("data-generate-ready",ready?"true":"false");
    input.setAttribute("data-url-valid",ready?"true":"false");
  }
  paint();
  var timer=setInterval(paint,400);
  function stop(){ if(!timer) return; clearInterval(timer); timer=0; }
  setTimeout(stop,20000);
  document.addEventListener("visibilitychange",function(){ if(document.hidden) stop(); });
  var going=false;
  document.addEventListener("click",function(event){
    var node=event.target;
    var btn=node&&node.closest?node.closest("#yt-generate"):null;
    if(!btn) return;
    if(going||btn.disabled){event.preventDefault();event.stopImmediatePropagation();return;}
    event.preventDefault();
    event.stopImmediatePropagation();
    going=true;
    document.documentElement.dataset.generating="1";
    btn.disabled=true;
    btn.setAttribute("aria-busy","true");
    var input=document.getElementById("yt-url");
    var value=input&&input.value?String(input.value).trim():"";
    window.location.assign("/process?url="+encodeURIComponent(value));
  },true);
})();`;

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [readyPulse, setReadyPulse] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasReady = useRef(false);
  const canGenerate = isLikelyYouTubeUrl(url);

  function applyUrl(value: string) {
    if (inputRef.current && inputRef.current.value !== value) {
      inputRef.current.value = value;
    }
    setUrl(value);
    if (error) setError(null);
  }

  function pullField() {
    const next = inputRef.current?.value;
    if (typeof next === "string" && next !== url) applyUrl(next);
  }

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const next = inputRef.current?.value ?? "";
    if (next) setUrl(next);
  }, []);

  // Mobile browsers (and the in-app preview) often insert a paste into the
  // field without a React change event. Poll the real input so Generate
  // highlights as soon as a link is sitting there.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const sync = () => {
      const next = el.value;
      setUrl((prev) => (prev === next ? prev : next));
    };

    let burst = 0;
    const burstSync = () => {
      window.clearInterval(burst);
      let n = 0;
      burst = window.setInterval(() => {
        sync();
        if (++n >= 8) window.clearInterval(burst);
      }, 80);
    };

    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
    el.addEventListener("keyup", sync);
    el.addEventListener("paste", burstSync);
    el.addEventListener("compositionend", burstSync);
    el.addEventListener("focus", sync);
    const idle = window.setInterval(sync, 500);
    const stop = window.setTimeout(() => window.clearInterval(idle), 20000);

    return () => {
      window.clearInterval(burst);
      window.clearInterval(idle);
      window.clearTimeout(stop);
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
      el.removeEventListener("keyup", sync);
      el.removeEventListener("paste", burstSync);
      el.removeEventListener("compositionend", burstSync);
      el.removeEventListener("focus", sync);
    };
  }, []);

  useEffect(() => {
    if (canGenerate && !wasReady.current) {
      setReadyPulse(true);
      wasReady.current = true;
      const t = window.setTimeout(() => setReadyPulse(false), 480);
      return () => window.clearTimeout(t);
    }
    if (!canGenerate) wasReady.current = false;
  }, [canGenerate]);

  const sent = useRef(false);

  function submit(raw?: string) {
    if (sent.current) return;
    sent.current = true;
    const value = (raw ?? inputRef.current?.value ?? url).trim();
    const id = parseYouTubeId(value);
    setError(null);
    setLeaving(true);
    void navigate({
      to: "/process",
      search: { url: id ? watchUrl(id) : value },
    });
  }

  return (
    <AppShell>
      <main data-app-ready="true">
        <section className="relative overflow-hidden">
          <div className="relative mx-auto max-w-3xl px-4 pb-14 pt-8 sm:px-6 sm:pt-16">
            <h1 className="font-display text-4xl leading-[1.08] tracking-tight sm:text-6xl">
              Read any YouTube video.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-muted">
              Paste a YouTube link. Generate opens a cleaned transcript of the video. Nothing else is written.
            </p>

            <form
              id="yt-form"
              action="/process"
              method="get"
              className="mt-8"
              onSubmit={(e) => {
                e.preventDefault();
                if (leaving || document.documentElement.dataset.generating === "1") return;
                submit();
              }}
            >
              <label htmlFor="yt-url" className="sr-only">
                YouTube URL
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  ref={inputRef}
                  id="yt-url"
                  name="url"
                  defaultValue=""
                  onChange={(e) => applyUrl(e.target.value)}
                  onInput={(e) => applyUrl(e.currentTarget.value)}
                  onPaste={(e) => {
                    const text =
                      e.clipboardData?.getData("text/plain") ||
                      e.clipboardData?.getData("text") ||
                      e.clipboardData?.getData("text/uri-list") ||
                      "";
                    if (text) {
                      e.preventDefault();
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? el.value.length;
                      const end = el.selectionEnd ?? el.value.length;
                      applyUrl(el.value.slice(0, start) + text + el.value.slice(end));
                    }
                  }}
                  onBlur={pullField}
                  placeholder="https://www.youtube.com/watch?v=…"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  aria-invalid={Boolean(error)}
                  className={cn(
                    "h-14 flex-1 rounded-xl px-5 text-base",
                    canGenerate && "border-accent shadow-[var(--shadow-ready)]",
                  )}
                />
                <Button
                  type="submit"
                  id="yt-generate"
                  size="lg"
                  variant={canGenerate ? "ready" : "idle"}
                  disabled={leaving}
                  className={cn(
                    "h-14 min-w-40 rounded-xl px-7 text-base font-semibold",
                    readyPulse && !leaving && "rt-ready-pop",
                  )}
                  onPointerDown={pullField}
                >
                  {leaving ? "Generating…" : "Generate"}
                  {leaving ? null : <ArrowRight className="size-4" />}
                </Button>
              </div>
              {error ? (
                <p className="mt-2 text-sm text-danger" role="alert">
                  {error}
                </p>
              ) : (
                <div className="yt-hints">
                  <p className="yt-hint-empty mt-2 text-sm text-faint">
                    Paste a YouTube URL to enable Generate.
                  </p>
                  <p className="yt-hint-bad mt-2 text-sm text-faint">
                    That does not look like a YouTube link yet.
                  </p>
                  <p className="yt-hint-ready mt-2 text-sm text-success">
                    {leaving ? "Generating…" : "Ready to generate."}
                  </p>
                </div>
              )}
            </form>
            <script dangerouslySetInnerHTML={{ __html: GENERATE_WATCH }} />
          </div>
        </section>

        <SampleShelf />
      </main>
    </AppShell>
  );
}

const SampleShelf = memo(function SampleShelf() {
  const navigate = useNavigate();
  const sent = useRef(false);

  return (
    <section className="border-t border-border [content-visibility:auto] [contain-intrinsic-size:auto_520px]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl tracking-tight sm:text-3xl">
          Sample videos
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SAMPLE_VIDEOS.map((video) => (
            <li key={video.id}>
              <SampleCard
                video={video}
                onOpen={() => {
                  if (sent.current || document.documentElement.dataset.generating === "1") return;
                  sent.current = true;
                  document.documentElement.dataset.generating = "1";
                  void navigate({
                    to: "/process",
                    search: { url: watchUrl(video.id) },
                  });
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
});

function SampleCard({
  video,
  onOpen,
}: {
  video: VideoMeta;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex h-full w-full flex-col overflow-hidden rounded-2xl bg-elevated text-left shadow-[var(--shadow-border)]",
        "transition-[transform,box-shadow] duration-200 ease-out hover:shadow-[var(--shadow-border-hover)] active:scale-[0.99]",
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-surface">
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          fetchPriority="low"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute bottom-2 right-2 rounded-md bg-bg/80 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-fg">
          {formatDuration(video.durationSeconds)}
        </span>
      </div>
      <div className="flex flex-1 flex-col px-4 py-4">
        <h3 className="line-clamp-2 text-sm font-medium leading-5">
          {video.title}
        </h3>
        <p className="mt-1 text-xs text-muted">{video.channelName}</p>
        <span className="mt-4 inline-flex items-center gap-1 text-xs text-muted group-hover:text-fg">
          Open transcript
          <ArrowRight className="size-3" />
        </span>
      </div>
    </button>
  );
}
