-- Modify "team_configs" table
ALTER TABLE "team_configs" ADD COLUMN "builtin" character varying NULL;
-- Create index "teamconfig_team_id_builtin" to table: "team_configs"
CREATE UNIQUE INDEX "teamconfig_team_id_builtin" ON "team_configs" ("team_id", "builtin");
