-- Modify "team_configs" table
ALTER TABLE "team_configs" ADD COLUMN "asset_owner_id" character varying NOT NULL DEFAULT '', ADD COLUMN "asset_archived" boolean NOT NULL DEFAULT false;
-- Create index "teamconfig_team_id_kind_asset_owner_id_name" to table: "team_configs"
CREATE UNIQUE INDEX "teamconfig_team_id_kind_asset_owner_id_name" ON "team_configs" ("team_id", "kind", "asset_owner_id", "name");
DROP INDEX "teamconfig_team_id_kind_name";
-- Create "asset_selections" table
CREATE TABLE "asset_selections" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "config_id" character varying NOT NULL, "user_id" character varying NOT NULL, "version" bigint NOT NULL DEFAULT 0, "disabled" boolean NOT NULL DEFAULT false, "name" character varying NOT NULL DEFAULT '', PRIMARY KEY ("id"));
-- Create index "assetselection_team_id_user_id_config_id" to table: "asset_selections"
CREATE UNIQUE INDEX "assetselection_team_id_user_id_config_id" ON "asset_selections" ("team_id", "user_id", "config_id");
