const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const BOTTOM = 54;

export function transcriptPdfFilename(title: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `${cleaned || "Transcript"}-Transcript.pdf`;
}

export function buildTranscriptPdf(input: {
  title: string;
  channelName: string;
  url: string;
  lines: { time: string; text: string }[];
}): Uint8Array {
  const pages = paginate(input);
  return encodePdf(pages);
}

export function downloadTranscriptPdf(input: {
  title: string;
  channelName: string;
  url: string;
  segments: { startSeconds: number; text: string }[];
  fallbackText: string;
}): void {
  const lines =
    input.segments.length > 0
      ? input.segments.map((segment) => ({
          time: formatTimestamp(segment.startSeconds),
          text: segment.text,
        }))
      : input.fallbackText
          .split(/\n+/)
          .map((text) => text.trim())
          .filter(Boolean)
          .map((text) => ({ time: "", text }));
  const bytes = buildTranscriptPdf({
    title: input.title,
    channelName: input.channelName,
    url: input.url,
    lines,
  });
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const href = URL.createObjectURL(blob);
  const filename = transcriptPdfFilename(input.title);
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (ios) {
    const opened = window.open(href, "_blank", "noopener");
    if (!opened) window.location.assign(href);
  } else {
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(href), 4000);
}

function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function paginate(input: {
  title: string;
  channelName: string;
  url: string;
  lines: { time: string; text: string }[];
}): string[] {
  const pages: string[][] = [];
  let cmds: string[] = [];
  let y = PAGE_H - MARGIN;

  const nextPage = () => {
    if (cmds.length) pages.push(cmds);
    cmds = [];
    y = PAGE_H - MARGIN;
  };
  const ensure = (height: number) => {
    if (y - height < BOTTOM) nextPage();
  };

  ensure(22);
  cmds.push(textCmd(input.title || "Transcript", MARGIN, y, 16));
  y -= 22;
  ensure(16);
  cmds.push(textCmd(input.channelName || "YouTube", MARGIN, y, 11));
  y -= 16;
  ensure(16);
  cmds.push(textCmd(input.url, MARGIN, y, 10));
  y -= 28;

  const body = input.lines.length ? input.lines : [{ time: "", text: "" }];
  for (const line of body) {
    const wrapped = wrap(line.text, 78);
    const row = wrapped.length ? wrapped : [""];
    for (let i = 0; i < row.length; i++) {
      ensure(16);
      const time = i === 0 ? line.time : "";
      cmds.push(textCmd(time, MARGIN, y, 9));
      cmds.push(textCmd(row[i] ?? "", MARGIN + 62, y, 11));
      y -= 16;
    }
    y -= 4;
  }

  if (cmds.length) pages.push(cmds);
  return pages.map((page) => page.join("\n"));
}

function wrap(text: string, maxChars: number): string[] {
  const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const piece = word.length > maxChars ? word.slice(0, maxChars) : word;
    const next = cur ? `${cur} ${piece}` : piece;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = piece;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function textCmd(text: string, x: number, y: number, size: number): string {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(toWinAnsi(text))}) Tj ET`;
}

function toWinAnsi(s: string): string {
  return s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\t\n\r\x20-\x7E]/g, "");
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function encodePdf(pageStreams: string[]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const fontId = 3;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pageStreams.forEach((stream, index) => {
    const contentId = 4 + index * 2;
    const pageId = contentId + 1;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  });

  const kids = pageIds.map((id) => `${id} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${kids}] >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    const body = objects[id];
    if (!body) continue;
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
  }
  const xref = pdf.length;
  const count = objects.length;
  pdf += `xref\n0 ${count}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < count; id++) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
