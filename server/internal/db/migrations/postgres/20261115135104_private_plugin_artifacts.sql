-- Create "resource_artifacts" table
CREATE TABLE "resource_artifacts" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "author_id" character varying NOT NULL, "package" character varying NOT NULL, "version" character varying NOT NULL, "sha256" character varying NOT NULL, "size" bigint NOT NULL, "files" jsonb NOT NULL, "published" boolean NOT NULL DEFAULT false, PRIMARY KEY ("id"));
-- Create index "resourceartifact_team_id_author_id" to table: "resource_artifacts"
CREATE INDEX "resourceartifact_team_id_author_id" ON "resource_artifacts" ("team_id", "author_id");
-- Create index "resourceartifact_team_id_package_version" to table: "resource_artifacts"
CREATE UNIQUE INDEX "resourceartifact_team_id_package_version" ON "resource_artifacts" ("team_id", "package", "version");
