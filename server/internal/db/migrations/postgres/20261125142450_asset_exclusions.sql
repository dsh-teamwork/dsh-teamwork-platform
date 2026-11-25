-- Create "asset_exclusions" table
CREATE TABLE "asset_exclusions" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "user_id" character varying NOT NULL, "config_id" character varying NOT NULL, "host_id" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "assetexclusion_host_id" to table: "asset_exclusions"
CREATE INDEX "assetexclusion_host_id" ON "asset_exclusions" ("host_id");
-- Create index "assetexclusion_team_id_user_id_config_id_host_id" to table: "asset_exclusions"
CREATE UNIQUE INDEX "assetexclusion_team_id_user_id_config_id_host_id" ON "asset_exclusions" ("team_id", "user_id", "config_id", "host_id");
