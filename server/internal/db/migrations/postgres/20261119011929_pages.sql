-- Create "pages" table
CREATE TABLE "pages" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "owner_id" character varying NOT NULL, "kind" character varying NOT NULL, "title" character varying NOT NULL, "sharing" character varying NOT NULL DEFAULT 'private', "current_version" bigint NOT NULL, "updated_at" timestamptz NOT NULL, PRIMARY KEY ("id"));
-- Create index "page_team_id_owner_id_updated_at" to table: "pages"
CREATE INDEX "page_team_id_owner_id_updated_at" ON "pages" ("team_id", "owner_id", "updated_at");
-- Create index "page_team_id_sharing_updated_at" to table: "pages"
CREATE INDEX "page_team_id_sharing_updated_at" ON "pages" ("team_id", "sharing", "updated_at");
-- Create "page_files" table
CREATE TABLE "page_files" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "version_id" character varying NOT NULL, "team_id" character varying NOT NULL, "path" character varying NOT NULL, "content_type" character varying NOT NULL, "size" bigint NOT NULL, "digest" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "pagefile_team_id_digest" to table: "page_files"
CREATE INDEX "pagefile_team_id_digest" ON "page_files" ("team_id", "digest");
-- Create index "pagefile_version_id_path" to table: "page_files"
CREATE UNIQUE INDEX "pagefile_version_id_path" ON "page_files" ("version_id", "path");
-- Create "page_members" table
CREATE TABLE "page_members" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "page_id" character varying NOT NULL, "user_id" character varying NOT NULL, "added_by" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "pagemember_page_id_user_id" to table: "page_members"
CREATE UNIQUE INDEX "pagemember_page_id_user_id" ON "page_members" ("page_id", "user_id");
-- Create index "pagemember_user_id_page_id" to table: "page_members"
CREATE INDEX "pagemember_user_id_page_id" ON "page_members" ("user_id", "page_id");
-- Create "page_versions" table
CREATE TABLE "page_versions" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "page_id" character varying NOT NULL, "number" bigint NOT NULL, "author_id" character varying NOT NULL, "host_id" character varying NOT NULL DEFAULT '', "computer" character varying NOT NULL DEFAULT '', "session_id" character varying NOT NULL DEFAULT '', "note" character varying NOT NULL DEFAULT '', "size" bigint NOT NULL, PRIMARY KEY ("id"));
-- Create index "pageversion_page_id_number" to table: "page_versions"
CREATE UNIQUE INDEX "pageversion_page_id_number" ON "page_versions" ("page_id", "number");
