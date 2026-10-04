import { SAMPLE_VIDEOS } from "@/lib/catalog";
import { getSql } from "@/lib/db";
import { isRealTranscriptPack } from "@/lib/pack";
import type {
  AiOutput,
  Chapter,
  HistoryItem,
  ReadingMode,
  StudyNotes,
  Transcript,
  TranscriptSegment,
  UserSettings,
  VideoMeta,
  VideoPack,
} from "@/lib/types";

type VideoRow = {
  id: string;
  url: string;
  title: string;
  channel_name: string;
  channel_url: string;
  thumbnail_url: string;
  duration_seconds: number;
  description: string;
};

type TranscriptRow = {
  video_id: string;
  raw_text: string;
  cleaned_text: string;
  segments_json: string;
  language: string;
  source: string;
};

type OutputRow = {
  video_id: string;
  quick_read: string;
  detailed_read: string;
  study_notes_json: string;
  chapters_json: string;
  takeaways_json: string;
  topics_json: string;
  reading_time_quick: number;
  reading_time_detailed: number;
  reading_time_notes: number;
  model: string;
  knowledge_map_json?: string | null;
  semantic_transcript_json?: string | null;
};

export async function getPack(videoId: string): Promise<VideoPack | null> {
  const sql = await getSql();
  const videos = await sql<VideoRow>`select * from videos where id = ${videoId}`;
  const video = videos[0];
  if (!video) return null;
  const transcripts = await sql<TranscriptRow>`
    select * from transcripts where video_id = ${videoId}
  `;
  const outputs = await sql<OutputRow>`
    select * from ai_outputs where video_id = ${videoId}
  `;
  const t = transcripts[0];
  const o = outputs[0];
  if (!t || !o) return null;
  const pack: VideoPack = {
    video: rowToMeta(video),
    transcript: rowToTranscript(t),
    output: rowToOutput(o),
  };
  if (!isRealTranscriptPack(pack)) return null;
  return pack;
}

export async function listCatalog(): Promise<VideoMeta[]> {
  return SAMPLE_VIDEOS;
}

export async function savePack(pack: VideoPack): Promise<void> {
  const sql = await getSql();
  await upsertPack(sql, pack);
}

async function upsertPack(
  sql: Awaited<ReturnType<typeof getSql>>,
  pack: VideoPack,
) {
  const v = pack.video;
  const t = pack.transcript;
  const o = pack.output;
  await sql`
    insert into videos (id, url, title, channel_name, channel_url, thumbnail_url, duration_seconds, description)
    values (${v.id}, ${v.url}, ${v.title}, ${v.channelName}, ${v.channelUrl}, ${v.thumbnailUrl}, ${v.durationSeconds}, ${v.description})
    on conflict (id) do update set
      url = excluded.url,
      title = excluded.title,
      channel_name = excluded.channel_name,
      channel_url = excluded.channel_url,
      thumbnail_url = excluded.thumbnail_url,
      duration_seconds = excluded.duration_seconds,
      description = excluded.description
  `;
  await sql`
    insert into transcripts (video_id, raw_text, cleaned_text, segments_json, language, source)
    values (${v.id}, ${t.rawText}, ${t.cleanedText}, ${JSON.stringify(t.segments)}, ${t.language}, ${t.source})
    on conflict (video_id) do update set
      raw_text = excluded.raw_text,
      cleaned_text = excluded.cleaned_text,
      segments_json = excluded.segments_json,
      language = excluded.language,
      source = excluded.source
  `;
  await sql`
    insert into ai_outputs (
      video_id, quick_read, detailed_read, study_notes_json, chapters_json,
      takeaways_json, topics_json, reading_time_quick, reading_time_detailed,
      reading_time_notes, model, knowledge_map_json, semantic_transcript_json
    ) values (
      ${v.id}, ${o.quickRead}, ${o.detailedRead}, ${JSON.stringify(o.studyNotes)},
      ${JSON.stringify(o.chapters)}, ${JSON.stringify(o.takeaways)},
      ${JSON.stringify(o.topics)}, ${o.readingTimeQuick}, ${o.readingTimeDetailed},
      ${o.readingTimeNotes}, ${o.model}, ${"{}"}, ${"[]"}
    )
    on conflict (video_id) do update set
      quick_read = excluded.quick_read,
      detailed_read = excluded.detailed_read,
      study_notes_json = excluded.study_notes_json,
      chapters_json = excluded.chapters_json,
      takeaways_json = excluded.takeaways_json,
      topics_json = excluded.topics_json,
      reading_time_quick = excluded.reading_time_quick,
      reading_time_detailed = excluded.reading_time_detailed,
      reading_time_notes = excluded.reading_time_notes,
      model = excluded.model,
      knowledge_map_json = excluded.knowledge_map_json,
      semantic_transcript_json = excluded.semantic_transcript_json
  `;
}

function rowToMeta(row: VideoRow): VideoMeta {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    channelName: row.channel_name,
    channelUrl: row.channel_url,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: Number(row.duration_seconds) || 0,
    description: row.description,
  };
}

function rowToTranscript(row: TranscriptRow): Transcript {
  return {
    rawText: row.raw_text,
    cleanedText: row.cleaned_text,
    segments: parseJson<TranscriptSegment[]>(row.segments_json, []),
    language: row.language,
    source: row.source,
  };
}

function rowToOutput(row: OutputRow): AiOutput {
  return {
    quickRead: row.quick_read,
    detailedRead: row.detailed_read,
    studyNotes: parseJson<StudyNotes>(row.study_notes_json, {
      overview: "",
      outline: [],
      keyTerms: [],
      questions: [],
    }),
    chapters: parseJson<Chapter[]>(row.chapters_json, []),
    takeaways: parseJson<string[]>(row.takeaways_json, []),
    topics: parseJson<string[]>(row.topics_json, []),
    readingTimeQuick: Number(row.reading_time_quick) || 1,
    readingTimeDetailed: Number(row.reading_time_detailed) || 1,
    readingTimeNotes: Number(row.reading_time_notes) || 1,
    model: row.model,
  };
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function listHistory(userId: string): Promise<HistoryItem[]> {
  const sql = await getSql();
  const rows = await sql<{
    video_id: string;
    last_mode: string;
    updated_at: string;
    id: string;
    url: string;
    title: string;
    channel_name: string;
    channel_url: string;
    thumbnail_url: string;
    duration_seconds: number;
    description: string;
  }>`
    select h.video_id, h.last_mode, h.updated_at,
           v.id, v.url, v.title, v.channel_name, v.channel_url,
           v.thumbnail_url, v.duration_seconds, v.description
    from user_history h
    join videos v on v.id = h.video_id
    join transcripts t on t.video_id = h.video_id
    join ai_outputs o on o.video_id = h.video_id
    where h.user_id = ${userId}
      and t.source in ('youtube', 'youtube-asr', 'ytdlp')
    order by h.updated_at desc
  `;
  return rows.map((r) => ({
    videoId: r.video_id,
    lastMode: (r.last_mode as ReadingMode) || "quick",
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : String(r.updated_at),
    video: {
      id: r.id,
      url: r.url,
      title: r.title,
      channelName: r.channel_name,
      channelUrl: r.channel_url,
      thumbnailUrl: r.thumbnail_url,
      durationSeconds: Number(r.duration_seconds) || 0,
      description: r.description,
    },
  }));
}

export async function upsertHistory(
  userId: string,
  videoId: string,
  lastMode: ReadingMode,
): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into user_history (user_id, video_id, last_mode, updated_at)
    values (${userId}, ${videoId}, ${lastMode}, now())
    on conflict (user_id, video_id) do update set
      last_mode = excluded.last_mode,
      updated_at = now()
  `;
}

export async function deleteHistory(
  userId: string,
  videoId: string,
): Promise<void> {
  const sql = await getSql();
  await sql`
    delete from user_history where user_id = ${userId} and video_id = ${videoId}
  `;
}

export async function getHistoryMode(
  userId: string,
  videoId: string,
): Promise<ReadingMode | null> {
  const sql = await getSql();
  const rows = await sql<{ last_mode: string }>`
    select last_mode from user_history
    where user_id = ${userId} and video_id = ${videoId}
    limit 1
  `;
  const mode = rows[0]?.last_mode;
  if (
    mode === "quick" ||
    mode === "detailed" ||
    mode === "chapters" ||
    mode === "notes" ||
    mode === "transcript"
  ) {
    return mode;
  }
  return null;
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultMode: "quick",
  fontSize: "md",
  theme: "dark",
};

export async function getSettings(userId: string): Promise<UserSettings> {
  const sql = await getSql();
  const rows = await sql<{
    default_mode: string;
    font_size: string;
    theme: string;
  }>`select default_mode, font_size, theme from user_settings where user_id = ${userId}`;
  const row = rows[0];
  if (!row) return DEFAULT_SETTINGS;
  return {
    defaultMode: (row.default_mode as ReadingMode) || "quick",
    fontSize: (row.font_size as UserSettings["fontSize"]) || "md",
    theme: (row.theme as UserSettings["theme"]) || "dark",
  };
}

export async function saveSettings(
  userId: string,
  settings: UserSettings,
): Promise<void> {
  const sql = await getSql();
  await sql`
    insert into user_settings (user_id, default_mode, font_size, theme, updated_at)
    values (${userId}, ${settings.defaultMode}, ${settings.fontSize}, ${settings.theme}, now())
    on conflict (user_id) do update set
      default_mode = excluded.default_mode,
      font_size = excluded.font_size,
      theme = excluded.theme,
      updated_at = now()
  `;
}
