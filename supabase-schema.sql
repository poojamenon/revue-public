-- Run this once in your Supabase project's SQL editor (SQL Editor -> New query)
-- when setting up a new project.
--
-- Every row belongs to a Supabase Auth user. Row-level security lets a
-- signed-in user read and change only their own rows; without signing in,
-- the public anon key can't see anything.

create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  week_of date not null,
  work text not null,
  colleagues text[] default '{}',
  went_well text,
  was_hard text,
  flag boolean default false,
  goal_ids text[] default '{}',
  created_at timestamptz default now()
);

create table colleagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

-- One row per person per user, ignoring capitalisation
create unique index colleagues_user_name_key on colleagues (user_id, lower(name));

create table drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  type text not null,
  period_start date,
  period_end date,
  content jsonb,
  created_at timestamptz default now()
);

create table manager_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  period_start date,
  period_end date,
  content text not null,
  created_at timestamptz default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  source_feedback_id uuid references manager_feedback(id) on delete set null,
  title text not null,
  description text,
  status text default 'active',
  created_at timestamptz default now()
);

-- Notes you add about a colleague in Peer Feedback, each with the time you added it
create table colleague_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  colleague_id uuid not null references colleagues(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);

create index colleague_notes_colleague_idx on colleague_notes (colleague_id);

-- People who report to you (Managing), and the notes you keep about each of them
create table reportees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  role text,
  -- When they started reporting to you
  joined_on date,
  created_at timestamptz default now()
);

-- type is 'mine' (feedback you gave), 'others' (said by the people in said_by), 'win' or 'improve'
create table reportee_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  reportee_id uuid not null references reportees(id) on delete cascade,
  type text not null,
  content text not null,
  said_by text[] default '{}',
  created_at timestamptz default now()
);

create index reportee_notes_reportee_idx on reportee_notes (reportee_id);

-- Review summaries drafted from a reportee's notes: one per reportee per review period
create table review_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  reportee_id uuid not null references reportees(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  content text not null,
  created_at timestamptz default now(),
  updated_at timestamptz,
  unique (reportee_id, period_start)
);

-- Row-level security: each signed-in user can only reach their own rows
alter table entries enable row level security;
alter table colleagues enable row level security;
alter table drafts enable row level security;
alter table manager_feedback enable row level security;
alter table goals enable row level security;
alter table colleague_notes enable row level security;
alter table reportees enable row level security;
alter table reportee_notes enable row level security;
alter table review_summaries enable row level security;

create policy "own rows" on entries for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on colleagues for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on drafts for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on manager_feedback for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on goals for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on colleague_notes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on reportees for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on reportee_notes for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on review_summaries for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
