import { spawn } from "node:child_process";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export type YtDlpRuntime = {
  canRun: boolean;
  reason: string;
  vercel: boolean;
  command?: string;
  moduleArgs?: string[];
};

export type YtDlpCaptionFile = {
  body: string;
  language: string;
  asr: boolean;
};

type YtDlpDump = {
  subtitles?: Record<string, { ext?: string; url?: string }[] | undefined>;
  automatic_captions?: Record<
    string,
    { ext?: string; url?: string }[] | undefined
  >;
};

let runtimeCache: YtDlpRuntime | undefined;

export function sessionNeedsYtDlpFallback(session: {
  tracks: unknown[];
  player?: { playabilityStatus?: { status?: string } } | null;
}): boolean {
  const status = session.player?.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED" || status === "UNPLAYABLE") return true;
  return session.tracks.length === 0;
}

export function ytdlpProductionBlocked(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function getYtDlpRuntime(): Promise<YtDlpRuntime> {
  if (runtimeCache) return runtimeCache;
  const vercel = ytdlpProductionBlocked();
  if (vercel) {
    runtimeCache = {
      canRun: false,
      vercel: true,
      reason:
        "Published Vercel is Node serverless — no Python/yt-dlp runtime. Fallback will not run in production.",
    };
    return runtimeCache;
  }

  const py = await firstWorking(["python3", "python"]);
  if (!py) {
    runtimeCache = {
      canRun: false,
      vercel: false,
      reason: "python3 not found",
    };
    return runtimeCache;
  }

  const imported = await execOk(py, ["-c", "import yt_dlp"]);
  if (!imported) {
    runtimeCache = {
      canRun: false,
      vercel: false,
      command: py,
      reason: "yt_dlp module not installed",
    };
    return runtimeCache;
  }

  runtimeCache = {
    canRun: true,
    vercel: false,
    command: py,
    moduleArgs: ["-m", "yt_dlp"],
    reason: "ok",
  };
  return runtimeCache;
}

export async function fetchYtDlpCaptionFile(
  videoId: string,
  proxyUrl?: string | null,
): Promise<YtDlpCaptionFile | null> {
  if (!VIDEO_ID.test(videoId)) return null;
  const runtime = await getYtDlpRuntime();
  if (!runtime.canRun || !runtime.command) {
    console.info("[readtube] yt-dlp fallback skipped:", runtime.reason);
    return null;
  }

  try {
    const args = [
      ...(runtime.moduleArgs ?? []),
      "-J",
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--js-runtimes",
      "node",
      "--socket-timeout",
      "20",
    ];
    if (proxyUrl) args.push("--proxy", proxyUrl);
    args.push(`https://www.youtube.com/watch?v=${videoId}`);

    const stdout = await spawnStdout(runtime.command, args, 32000);
    const dump = JSON.parse(stdout) as YtDlpDump;
    const picked = pickCaptionUrl(dump);
    if (!picked?.url) return null;

    const body = await downloadCaption(picked.url, proxyUrl);
    if (!body?.trim()) return null;
    return { body, language: picked.language, asr: picked.asr };
  } catch (err) {
    console.info(
      "[readtube] yt-dlp fallback failed:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

function pickCaptionUrl(dump: YtDlpDump): {
  url: string;
  language: string;
  asr: boolean;
} | null {
  const preferLang = (langs: string[]) => {
    for (const want of ["en", "en-US", "en-orig", "en-GB"]) {
      if (langs.includes(want)) return want;
    }
    return langs.find((l) => l.toLowerCase().startsWith("en")) ?? langs[0];
  };
  const preferExt = (rows: { ext?: string; url?: string }[]) => {
    for (const ext of ["json3", "srv3", "vtt", "ttml", "srv1"]) {
      const hit = rows.find((r) => r.ext === ext && r.url);
      if (hit?.url) return hit.url;
    }
    return rows.find((r) => r.url)?.url;
  };

  const manual = dump.subtitles ?? {};
  const auto = dump.automatic_captions ?? {};
  const manualLang = preferLang(Object.keys(manual));
  if (manualLang) {
    const url = preferExt(manual[manualLang] ?? []);
    if (url) return { url, language: manualLang, asr: false };
  }
  const autoLang = preferLang(Object.keys(auto));
  if (autoLang) {
    const url = preferExt(auto[autoLang] ?? []);
    if (url) return { url, language: autoLang, asr: true };
  }
  return null;
}

async function downloadCaption(
  url: string,
  proxyUrl?: string | null,
): Promise<string | null> {
  const dispatcher = proxyUrl
    ? new ProxyAgent({ uri: proxyUrl, pipelining: 0 })
    : undefined;
  const res = await undiciFetch(url, {
    dispatcher,
    headers: {
      "User-Agent": CHROME_UA,
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "*/*",
      Referer: "https://www.youtube.com/",
    },
  });
  if (!res.ok) return null;
  return res.text();
}

function spawnStdout(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(err.trim().slice(-400) || `yt-dlp exit ${code}`));
        return;
      }
      const jsonStart = out.indexOf("{");
      resolve(jsonStart >= 0 ? out.slice(jsonStart) : out);
    });
  });
}

function execOk(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function firstWorking(commands: string[]): Promise<string | null> {
  for (const cmd of commands) {
    if (await execOk(cmd, ["-c", "pass"])) return cmd;
  }
  return null;
}
