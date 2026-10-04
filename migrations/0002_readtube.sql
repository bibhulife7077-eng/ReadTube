-- ReadTube V1 schema
-- videos / transcripts / ai_outputs are a shared cache (not personal data).
-- user_history and user_settings are per-user and must be scoped by user_id.

create table if not exists videos (
  id text primary key,
  url text not null,
  title text not null,
  channel_name text not null,
  channel_url text not null default '',
  thumbnail_url text not null,
  duration_seconds integer not null default 0,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists transcripts (
  video_id text primary key references videos(id) on delete cascade,
  raw_text text not null,
  cleaned_text text not null,
  segments_json text not null default '[]',
  language text not null default 'en',
  source text not null default 'mock',
  created_at timestamptz not null default now()
);

create table if not exists ai_outputs (
  video_id text primary key references videos(id) on delete cascade,
  quick_read text not null,
  detailed_read text not null,
  study_notes_json text not null,
  chapters_json text not null,
  takeaways_json text not null,
  topics_json text not null,
  reading_time_quick integer not null,
  reading_time_detailed integer not null,
  reading_time_notes integer not null,
  model text not null default 'catalog',
  created_at timestamptz not null default now()
);

create table if not exists user_history (
  id serial primary key,
  user_id text not null,
  video_id text not null references videos(id) on delete cascade,
  last_mode text not null default 'quick',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, video_id)
);

create index if not exists user_history_user_idx
  on user_history (user_id, updated_at desc);

create table if not exists user_settings (
  user_id text primary key,
  default_mode text not null default 'quick',
  font_size text not null default 'md',
  theme text not null default 'dark',
  updated_at timestamptz not null default now()
);
