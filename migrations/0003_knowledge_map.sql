-- Saved Video Knowledge Map. Reading modes are rendered from this JSON.
alter table ai_outputs
  add column if not exists knowledge_map_json text not null default '{}';
