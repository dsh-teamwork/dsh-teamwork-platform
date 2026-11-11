-- Extensions the migrations rely on, created once when the volume is new.
-- The tables themselves come from `pnpm db:deploy`, never from here.

-- gen_random_bytes(), which nanoid() is built on.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Case-insensitive text, for any column that needs it.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

-- Where `pnpm db:drift` replays the migrations (SHADOW_DATABASE_URL), named as
-- the shared stack names it.
CREATE DATABASE dsh_teamwork_shadow;
