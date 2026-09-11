-- The Curb · store schema
--
-- Run this once against the target database before starting the app. It is
-- deliberately a plain SQL file rather than a migration framework: there is one
-- version of it, it is idempotent, and an operator can read the whole thing
-- before running it.
--
-- Notes that are decisions, not conventions:
--
--   * `observations.value` is `numeric`, not `double precision`. A token with
--     eighteen decimals needs more significant digits than a double carries, and
--     a precision loss at write time cannot be undone. `raw` and `decimals` keep
--     the integer the chain actually gave, so any amount can be reproduced
--     exactly no matter what `value` rounded to.
--
--   * `run_lock` is a table with a TTL rather than `pg_try_advisory_lock`.
--     Advisory locks are bound to a session, and a connection pooler can hand
--     back a different session between taking the lock and releasing it — which
--     leaves a lock nobody can release. A row with an expiry is safe under
--     pooling and survives a process that dies holding it.

create table if not exists heartbeats (
  id               bigserial   primary key,
  agent_id         text        not null,
  run_at           timestamptz not null,
  outcome          text        not null,
  sources_reached  integer     not null,
  sources_expected integer     not null,
  oldest_input_at  timestamptz,
  publication_id   uuid,
  detail           text
);

-- Serves "the latest heartbeat per agent", which is the hottest read here.
create index if not exists heartbeats_agent_run_at
  on heartbeats (agent_id, run_at desc);

create table if not exists publications (
  id              uuid        primary key,
  agent_id        text        not null,
  published_at    timestamptz not null,
  headline        text        not null,
  body            text        not null,
  figures         jsonb       not null,
  sources_reached integer     not null
);

create index if not exists publications_published_at
  on publications (published_at desc);

-- An agent's own page reads its filings newest-first.
create index if not exists publications_agent_published_at
  on publications (agent_id, published_at desc);

-- A blocked output is an event to look at, not a silence: the text and the rule
-- it broke are both kept in full so the block can be reviewed rather than guessed.
create table if not exists blocks (
  id         uuid        primary key,
  agent_id   text        not null,
  blocked_at timestamptz not null,
  headline   text        not null,
  body       text        not null,
  breaches   jsonb       not null
);

create index if not exists blocks_blocked_at
  on blocks (blocked_at desc);

create table if not exists observations (
  id          bigserial   primary key,
  key         text        not null,
  observed_at timestamptz not null,
  value       numeric     not null,
  raw         text,
  decimals    integer,
  source      text        not null
);

create index if not exists observations_key_observed_at
  on observations (key, observed_at desc);

-- Exactly one row, ever. The check constraint makes a second lock impossible
-- rather than merely unlikely.
create table if not exists run_lock (
  id         integer     primary key default 1,
  holder     text        not null,
  expires_at timestamptz not null,
  constraint run_lock_is_singular check (id = 1)
);

-- A narrated lede for one closed day. The model writes prose over the day's
-- record; it never supplies a figure. `edition_hash` pins which composition of
-- the record the prose was written for, so a narration cannot outlive the
-- edition it describes. `outcome` records refusals and policy blocks as real
-- outcomes rather than silently substituting the templated lede.
create table if not exists narrations (
  day          text        primary key,
  edition_hash text        not null,
  outcome      text        not null,
  standfirst   text,
  model        text,
  detail       text,
  generated_at timestamptz not null
);

-- One row per key, replaced on write: the latest state of each feed and token,
-- for pages that need "now" without reading a series back.
create table if not exists snapshots (
  key         text        primary key,
  observed_at timestamptz not null,
  payload     jsonb       not null
);
