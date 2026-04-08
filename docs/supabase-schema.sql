create extension if not exists pgcrypto;

create table if not exists public.answer_knowledge (
  category text not null,
  normalized_answer text not null,
  answer text not null,
  total_sessions integer not null default 0,
  user_guess_plays integer not null default 0,
  user_guess_wins integer not null default 0,
  user_guess_total_turns integer not null default 0,
  ai_guess_plays integer not null default 0,
  ai_guess_successes integer not null default 0,
  last_played_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (category, normalized_answer)
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  mode text not null check (mode in ('ai-guesses', 'user-guesses')),
  category text not null,
  answer text not null,
  normalized_answer text not null,
  outcome text not null check (outcome in ('solved', 'failed', 'ai_correct', 'revealed')),
  turn_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists game_sessions_created_at_idx
  on public.game_sessions (created_at desc);

create index if not exists game_sessions_category_answer_idx
  on public.game_sessions (category, normalized_answer);

create index if not exists answer_knowledge_total_sessions_idx
  on public.answer_knowledge (total_sessions desc, last_played_at desc);
