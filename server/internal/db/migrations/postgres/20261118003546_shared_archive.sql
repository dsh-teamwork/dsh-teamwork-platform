-- Create "shared_archive_segments" table
CREATE TABLE "shared_archive_segments" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "host_id" character varying NOT NULL, "team_id" character varying NOT NULL, "seq" bigint NOT NULL, "prev_digest" character varying NOT NULL, "digest" character varying NOT NULL, "data" bytea NOT NULL, PRIMARY KEY ("id"));
-- Create index "shared_archive_host_seq" to table: "shared_archive_segments"
CREATE UNIQUE INDEX "shared_archive_host_seq" ON "shared_archive_segments" ("host_id", "seq");
-- Create index "shared_archive_team" to table: "shared_archive_segments"
CREATE INDEX "shared_archive_team" ON "shared_archive_segments" ("team_id");
