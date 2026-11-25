-- Modify "asset_selections" table
ALTER TABLE "asset_selections" ADD COLUMN "history" jsonb NULL, ADD COLUMN "revision" bigint NOT NULL DEFAULT 0;
