-- Create "config_revisions" table
CREATE TABLE "config_revisions" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "config_id" character varying NOT NULL, "version" bigint NOT NULL, "kind" character varying NOT NULL, "name" character varying NOT NULL, "data" jsonb NOT NULL, "author_id" character varying NOT NULL DEFAULT '', "reviewer_id" character varying NOT NULL DEFAULT '', "note" character varying NOT NULL DEFAULT '', "source" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "configrevision_team_id_config_id_version" to table: "config_revisions"
CREATE UNIQUE INDEX "configrevision_team_id_config_id_version" ON "config_revisions" ("team_id", "config_id", "version");
-- Create index "configrevision_team_id_created_at" to table: "config_revisions"
CREATE INDEX "configrevision_team_id_created_at" ON "config_revisions" ("team_id", "created_at");
-- Create "resource_submissions" table
CREATE TABLE "resource_submissions" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "author_id" character varying NOT NULL, "config_id" character varying NOT NULL, "base_version" bigint NOT NULL DEFAULT 0, "proposal" jsonb NOT NULL, "note" character varying NOT NULL DEFAULT '', "state" character varying NOT NULL DEFAULT 'draft', "revision" bigint NOT NULL DEFAULT 1, "reviewer_id" character varying NOT NULL DEFAULT '', "reason" character varying NOT NULL DEFAULT '', "decided_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "resourcesubmission_team_id_author_id" to table: "resource_submissions"
CREATE INDEX "resourcesubmission_team_id_author_id" ON "resource_submissions" ("team_id", "author_id");
-- Create index "resourcesubmission_team_id_state" to table: "resource_submissions"
CREATE INDEX "resourcesubmission_team_id_state" ON "resource_submissions" ("team_id", "state");
