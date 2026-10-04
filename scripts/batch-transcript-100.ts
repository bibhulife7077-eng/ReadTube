/**
 * Live batch: 100 YouTube URLs through ReadTube's real caption pipeline
 * (fetchYouTubeContent + word gate). No mocks, no AI.
 *
 *   node --experimental-strip-types scripts/batch-transcript-100.ts
 */
import { writeFileSync } from "node:fs";
import {
  cleanTranscriptText,
  fetchYouTubeContent,
  transcriptPassesGate,
  transcriptWordThreshold,
} from "../src/lib/server/youtube-fetch.ts";

type Category =
  | "manual"
  | "asr"
  | "music"
  | "podcast"
  | "ted"
  | "shorts"
  | "non-english";

type Case = { id: string; category: Category; label: string };

type Row = {
  n: number;
  id: string;
  url: string;
  category: Category;
  label: string;
  ok: boolean;
  reason: "ok" | "no_captions" | "below_gate" | "timeout" | "error";
  title: string | null;
  durationSeconds: number;
  words: number;
  threshold: number;
  language: string | null;
  source: string | null;
  snippet: string | null;
  ms: number;
  error: string | null;
};

const CASES: Case[] = [
  // --- TED talks (uploaded captions) ---
  { id: "eIho2S0ZahI", category: "ted", label: "Julian Treasure — How to speak" },
  { id: "Ks-_Mh1QhMc", category: "ted", label: "Amy Cuddy — Body language" },
  { id: "qp0HIF3SfI4", category: "ted", label: "Simon Sinek — Inspire action" },
  { id: "iCvmsMzlF7o", category: "ted", label: "Brené Brown — Vulnerability" },
  { id: "_QdPW8JrYzQ", category: "ted", label: "James Veitch — Spam email" },
  { id: "rrkrvAUbU9Y", category: "ted", label: "Dan Pink — Motivation" },
  { id: "c0KYU2j0TM4", category: "ted", label: "Susan Cain — Introverts" },
  { id: "P_6vDLq64gE", category: "ted", label: "Pamela Meyer — Spot a liar" },
  { id: "RcGyVTAoXEU", category: "ted", label: "Kelly McGonigal — Stress" },
  { id: "iG9CE55wbtY", category: "ted", label: "Ken Robinson — Creativity" },
  { id: "5MuIMqhT8DM", category: "ted", label: "Matt Walker — Sleep" },
  { id: "PY9DcIMGxMs", category: "ted", label: "Johann Hari — Addiction" },
  { id: "lmyZMtPVodo", category: "ted", label: "Simon Sinek — Feel safe" },
  { id: "8jPQjjsBbIc", category: "ted", label: "Daniel Levitin — Stay calm" },
  { id: "18uDutylDa4", category: "ted", label: "Sheryl Sandberg — Women leaders" },

  // --- Manual / educational uploaded captions ---
  { id: "aircAruvnKk", category: "manual", label: "3Blue1Brown — Neural networks" },
  { id: "fNk_zzaMoSs", category: "manual", label: "3Blue1Brown — Vectors" },
  { id: "WUvTyaaNkzM", category: "manual", label: "3Blue1Brown — Calculus" },
  { id: "r6sGWTCMz2k", category: "manual", label: "3Blue1Brown — Fourier series" },
  { id: "Ilg3gGewI5o", category: "manual", label: "3Blue1Brown — Backpropagation" },
  { id: "PFDu9oVAE-g", category: "manual", label: "3Blue1Brown — Eigenvalues" },
  { id: "jNQXAC9IVRw", category: "manual", label: "Me at the zoo (control)" },
  { id: "Yocja_N5s1I", category: "manual", label: "Crash Course — Agricultural Revolution" },
  { id: "B3u4EFTwprM", category: "manual", label: "Crash Course — Capitalism" },
  { id: "lTTvKwCylFY", category: "manual", label: "Crash Course — French Revolution" },
  { id: "Q78COTwT7nE", category: "manual", label: "Crash Course — WWII" },
  { id: "QW_jlUn4gA8", category: "manual", label: "Kurzgesagt — Godlike civilization" },
  { id: "0NY2gAftzJE", category: "manual", label: "Kurzgesagt — Cured cancer" },
  { id: "yDAAlojz8NU", category: "manual", label: "Kurzgesagt — Scariest place" },
  { id: "SbvAaDN1bpE", category: "manual", label: "Kurzgesagt — Puzzled by virus" },

  // --- ASR-typical (vlog / challenge / explainer) ---
  { id: "CcsUYu0PVxY", category: "asr", label: "ASR-only English fixture" },
  { id: "1WEAJ-DFkHE", category: "asr", label: "MrBeast — $1 vs $500,000 plane" },
  { id: "Dt-IFSvDJic", category: "asr", label: "Beast Reacts — Pencil" },
  { id: "HR1ig6u9-6A", category: "asr", label: "Beast Reacts — Try not to laugh" },
  { id: "DvkTX-AquQo", category: "asr", label: "Beast Reacts — Impossible odds" },
  { id: "JsBZOcqZerk", category: "asr", label: "Veritasium — Enigma machine" },
  { id: "Q10_srZ-pbs", category: "asr", label: "Veritasium — Theory of everything" },
  { id: "3LopI4YeC4I", category: "asr", label: "Veritasium — Delusional superpower" },
  { id: "NIk_0AW5hFU", category: "asr", label: "Veritasium — Faster than light" },
  { id: "0e3GPea1Tyg", category: "asr", label: "MrBeast — Squid Game" },
  { id: "2X_2IdybTV0", category: "asr", label: "MrBeast — Last to leave circle" },
  { id: "krsBRQbOP6c", category: "asr", label: "MrBeast — Buried alive" },
  { id: "0CTp1a-aDTE", category: "asr", label: "MrBeast — $1 vs $1,000,000 hotel" },
  { id: "Uxl5tye3XEI", category: "asr", label: "MrBeast — Prison" },
  { id: "dBauh8dQRfE", category: "asr", label: "MrBeast — 7 days stranded" },

  // --- Music videos ---
  { id: "dQw4w9WgXcQ", category: "music", label: "Rick Astley — Never Gonna Give You Up" },
  { id: "kJQP7kiw5Fk", category: "music", label: "Luis Fonsi — Despacito" },
  { id: "JGwWNGJdvx8", category: "music", label: "Ed Sheeran — Shape of You" },
  { id: "OPf0YbXqDm0", category: "music", label: "Mark Ronson — Uptown Funk" },
  { id: "09R8_2nJtjg", category: "music", label: "Maroon 5 — Sugar" },
  { id: "pRpeEdMmmQ0", category: "music", label: "Shakira — Waka Waka" },
  { id: "fJ9rUzIMcZQ", category: "music", label: "Queen — Bohemian Rhapsody" },
  { id: "YQHsXMglC9A", category: "music", label: "Adele — Hello" },
  { id: "60ItHLz5WEA", category: "music", label: "Alan Walker — Faded" },
  { id: "RgKAFK5djSk", category: "music", label: "Wiz Khalifa — See You Again" },
  { id: "CevxZvSJLk8", category: "music", label: "Katy Perry — Roar" },
  { id: "e-ORhEE9VVg", category: "music", label: "Taylor Swift — Blank Space" },
  { id: "2Vv-BfVoq4g", category: "music", label: "Ed Sheeran — Perfect" },
  { id: "7wtfhZwyrcc", category: "music", label: "Imagine Dragons — Believer" },
  { id: "XqZsoesa55w", category: "music", label: "Pinkfong — Baby Shark" },

  // --- Podcasts ---
  { id: "JN3KPFbWCy8", category: "podcast", label: "Lex Fridman #400 — Elon Musk" },
  { id: "DxREm3s1scA", category: "podcast", label: "Lex Fridman #252 — Elon Musk" },
  { id: "Kbk9BiPhm7o", category: "podcast", label: "Lex Fridman #438 — Neuralink" },
  { id: "smK9dgdTl40", category: "podcast", label: "Lex Fridman #49 — Elon Musk" },
  { id: "7qZl_5xHoBw", category: "podcast", label: "JRE #2223 — Elon Musk" },
  { id: "RcYjXbSJBN8", category: "podcast", label: "JRE #1470 — Elon Musk" },
  { id: "sSOxPJD-VNo", category: "podcast", label: "JRE #2281 — Elon Musk" },
  { id: "O4wBUysNe2k", category: "podcast", label: "JRE #2404 — Elon Musk" },
  { id: "0fKBhvDjuy0", category: "podcast", label: "JRE — Elon Musk (2018)" },
  { id: "TZqADzuu73g", category: "podcast", label: "JRE #2392 — John Kiriakou" },
  { id: "AVEZBy1uAk8", category: "podcast", label: "JRE #2440 — Damon & Affleck" },
  { id: "jvqFAi7vkBc", category: "podcast", label: "Lex Fridman — Sam Altman GPT-5" },
  { id: "L_Guz73e6fw", category: "podcast", label: "Lex Fridman — Sam Altman GPT-4" },
  { id: "nm1TxQj9IsQ", category: "podcast", label: "Huberman — Master your sleep" },
  { id: "QmOF0crdyRU", category: "podcast", label: "Huberman — Dopamine" },

  // --- Shorts / sub-60s clips ---
  { id: "0kBe5e8Kzms", category: "shorts", label: "Zach King — Lifeguard" },
  { id: "27XnIdWyqLs", category: "shorts", label: "Hamood Habibi Minecraft short" },
  { id: "nw_NabUj8ck", category: "shorts", label: "MrBeast Rizz meme short" },
  { id: "iiljcLsNH3I", category: "shorts", label: "MrBeast Rizz dance short" },
  { id: "FOEfsBqej1I", category: "shorts", label: "Funny cats 30s" },
  { id: "hmw-w4PFms8", category: "shorts", label: "Funny cat videos 30s" },
  { id: "oQ78byewHWY", category: "shorts", label: "Funny cats clips 30s" },
  { id: "1CXmnm_epTM", category: "shorts", label: "Cat cuteness 30s" },
  { id: "46gAXft4TMA", category: "shorts", label: "How to tie a tie 1 minute" },
  { id: "4RG1bQCvrno", category: "shorts", label: "Baby Shark 30 seconds" },
  { id: "AULn1UTcEwI", category: "shorts", label: "Baby Shark hand washing 30s" },
  { id: "zJV0eRwKooU", category: "shorts", label: "Second baguette short" },
  { id: "UNs-ziziPyo", category: "shorts", label: "Hans Rosling shortest TED" },
  { id: "txzOIGulUIQ", category: "shorts", label: "Shortest scientist debate" },
  { id: "-szZD4v646I", category: "shorts", label: "Worlds shortest TED talk" },

  // --- Non-English originals ---
  { id: "9bZkp7q19f0", category: "non-english", label: "PSY — Gangnam Style (ko)" },
  { id: "IHNzOHi8sJs", category: "non-english", label: "BLACKPINK — DDU-DU DDU-DU (ko)" },
  { id: "gdZLi9oWNZg", category: "non-english", label: "BTS — Dynamite (ko/en)" },
  { id: "AETFvQonfV8", category: "non-english", label: "Hanuman Chalisa (hi)" },
  { id: "Cr8K88UcO0s", category: "non-english", label: "Bad Bunny — Tití Me Preguntó (es)" },
  { id: "KU5V5WZVcVE", category: "non-english", label: "Bad Bunny — NUEVAYoL (es)" },
  { id: "TmKh7lAwnBI", category: "non-english", label: "Bad Bunny — DÁKITI (es)" },
  { id: "tK_f8hZLzZQ", category: "non-english", label: "ZDF heute-show (de)" },
  { id: "o6JE7tAxeos", category: "non-english", label: "NHK WORLD — 1980s nostalgia (ja)" },
  { id: "IKzWxfRRx54", category: "non-english", label: "NHK WORLD — senior citizens (ja)" },
];

if (CASES.length !== 100) {
  throw new Error(`expected 100 cases, got ${CASES.length}`);
}
const dup = CASES.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) throw new Error(`duplicate ids: ${dup.join(",")}`);

const CONCURRENCY = 5;
const PER_VIDEO_MS = 35000;
const OUT_JSON = "/workspace/artifacts/batch-transcript-100.json";
const OUT_MD = "/workspace/artifacts/batch-transcript-100.md";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function runOne(c: Case, n: number): Promise<Row> {
  const started = Date.now();
  const url = `https://www.youtube.com/watch?v=${c.id}`;
  const base: Omit<Row, "ok" | "reason" | "ms"> = {
    n,
    id: c.id,
    url,
    category: c.category,
    label: c.label,
    title: null,
    durationSeconds: 0,
    words: 0,
    threshold: 0,
    language: null,
    source: null,
    snippet: null,
    error: null,
  };
  try {
    const content = await withTimeout(fetchYouTubeContent(c.id), PER_VIDEO_MS);
    const duration = content.meta.durationSeconds || 0;
    const cleaned = content.captions
      ? cleanTranscriptText(content.captions.text)
      : "";
    const words = cleaned.trim().split(/\s+/).filter(Boolean).length;
    const threshold = transcriptWordThreshold(duration);
    const gated = Boolean(content.captions) && transcriptPassesGate(cleaned, duration);
    return {
      ...base,
      ok: gated,
      reason: !content.captions ? "no_captions" : gated ? "ok" : "below_gate",
      title: content.meta.title,
      durationSeconds: duration,
      words,
      threshold,
      language: content.captions?.language ?? null,
      source: content.captions?.source ?? null,
      snippet: cleaned ? cleaned.slice(0, 140) : null,
      ms: Date.now() - started,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timeout = /timeout/i.test(message);
    return {
      ...base,
      ok: false,
      reason: timeout ? "timeout" : "error",
      ms: Date.now() - started,
      error: message.slice(0, 240),
    };
  }
}

async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return out;
}

function pct(n: number, d: number) {
  return d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`;
}

function render(rows: Row[]) {
  const ok = rows.filter((r) => r.ok);
  const fail = rows.filter((r) => !r.ok);
  const cats = [...new Set(rows.map((r) => r.category))];
  const byCat = cats.map((cat) => {
    const slice = rows.filter((r) => r.category === cat);
    const wins = slice.filter((r) => r.ok).length;
    return `| ${cat} | ${slice.length} | ${wins} | ${slice.length - wins} | ${pct(wins, slice.length)} |`;
  });
  const reasons = ["no_captions", "below_gate", "timeout", "error"] as const;
  const reasonLines = reasons.map((r) => {
    const n = fail.filter((x) => x.reason === r).length;
    return `| ${r} | ${n} |`;
  });
  const failLines = fail.length
    ? fail
        .map(
          (r) =>
            `| ${r.category} | [${r.id}](${r.url}) | ${r.label} | ${r.reason} | ${r.words}/${r.threshold} | ${r.error ?? r.title ?? ""} |`,
        )
        .join("\n")
    : "_None._";

  return `# ReadTube batch transcript test (100 URLs)

Ran the live caption pipeline (\`fetchYouTubeContent\` + word gate). AI is not part of this test.

- **Total:** ${rows.length}
- **Success:** ${ok.length} (${pct(ok.length, rows.length)})
- **Failure:** ${fail.length} (${pct(fail.length, rows.length)})
- **Concurrency:** ${CONCURRENCY}
- **Per-video timeout:** ${PER_VIDEO_MS / 1000}s

## By category

| Category | N | Success | Fail | Rate |
|---|---:|---:|---:|---:|
${byCat.join("\n")}

## Failure reasons

| Reason | Count |
|---|---:|
${reasonLines.join("\n")}

## Failed URLs

| Category | Video | Label | Reason | Words/gate | Detail |
|---|---|---|---|---|---|
${failLines}

## All results

| # | Cat | ID | OK | Words | Lang | Source | Title |
|---:|---|---|---|---:|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.n} | ${r.category} | ${r.id} | ${r.ok ? "yes" : r.reason} | ${r.words} | ${r.language ?? ""} | ${r.source ?? ""} | ${(r.title ?? r.label).replace(/\|/g, "/")} |`,
  )
  .join("\n")}
`;
}

const started = Date.now();
console.log(`[batch] ${CASES.length} videos, concurrency ${CONCURRENCY}`);
const rows = await pool(CASES, CONCURRENCY, async (c, i) => {
  const row = await runOne(c, i + 1);
  const mark = row.ok ? "OK" : row.reason.toUpperCase();
  console.log(
    `[${String(i + 1).padStart(3, "0")}/100] ${mark.padEnd(12)} ${c.category.padEnd(12)} ${c.id}  ${row.words}w  ${(row.title ?? c.label).slice(0, 60)}`,
  );
  return row;
});

writeFileSync(OUT_JSON, JSON.stringify({ ms: Date.now() - started, rows }, null, 2));
writeFileSync(OUT_MD, render(rows));
const ok = rows.filter((r) => r.ok).length;
console.log(`[batch] done ${ok}/100 in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`[batch] wrote ${OUT_MD}`);
