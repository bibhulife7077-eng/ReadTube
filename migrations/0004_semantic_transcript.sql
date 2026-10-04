-- Cleaned semantic transcript the knowledge map is extracted from.
alter table ai_outputs
  add column if not exists semantic_transcript_json text not null default '[]';
