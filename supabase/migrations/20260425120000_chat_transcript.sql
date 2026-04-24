-- Persist full workout chat (text, images, assistant UI state) for edit/rehydrate.
alter table public.workout_sessions
  add column if not exists chat_transcript jsonb;

comment on column public.workout_sessions.chat_transcript is
  'Serialized workout chat messages (JSON array) for restoring the thread when editing a session.';
