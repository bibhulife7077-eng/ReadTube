export type ReadingMode = "quick" | "detailed" | "chapters" | "notes" | "transcript";

export type FontSize = "sm" | "md" | "lg";
export type ThemeName = "dark" | "light";

export type TranscriptSegment = {
  startSeconds: number;
  text: string;
};

export type Chapter = {
  id: string;
  title: string;
  startSeconds: number;
  endSeconds: number;
  summary: string;
};

export type StudyNotes = {
  overview: string;
  outline: { heading: string; bullets: string[] }[];
  keyTerms: { term: string; definition: string }[];
  questions: { q: string; a: string }[];
};

export type VideoMeta = {
  id: string;
  url: string;
  title: string;
  channelName: string;
  channelUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  description: string;
};

export type AiOutput = {
  quickRead: string;
  detailedRead: string;
  studyNotes: StudyNotes;
  chapters: Chapter[];
  takeaways: string[];
  topics: string[];
  readingTimeQuick: number;
  readingTimeDetailed: number;
  readingTimeNotes: number;
  model: string;
};

export type Transcript = {
  rawText: string;
  cleanedText: string;
  segments: TranscriptSegment[];
  language: string;
  source: string;
};

export type VideoPack = {
  video: VideoMeta;
  transcript: Transcript;
  output: AiOutput;
};

export type HistoryItem = {
  videoId: string;
  lastMode: ReadingMode;
  updatedAt: string;
  video: VideoMeta;
};

export type UserSettings = {
  defaultMode: ReadingMode;
  fontSize: FontSize;
  theme: ThemeName;
};
