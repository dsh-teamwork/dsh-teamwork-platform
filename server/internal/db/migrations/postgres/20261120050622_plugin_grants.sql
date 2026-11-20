-- Modify "relay_hosts" table
ALTER TABLE "relay_hosts" ADD COLUMN "grant_id" character varying NULL;
-- Create "plugin_grants" table
CREATE TABLE "plugin_grants" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "via" character varying NOT NULL, "used_at" timestamptz NOT NULL, "user_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "plugin_grants_users_plugin_grants" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "plugingrant_user_id" to table: "plugin_grants"
CREATE INDEX "plugingrant_user_id" ON "plugin_grants" ("user_id");
