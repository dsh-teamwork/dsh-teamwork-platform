-- Modify "shared_hosts" table
ALTER TABLE "shared_hosts" ADD COLUMN "access" character varying NOT NULL DEFAULT 'team';
-- Create "shared_host_members" table
CREATE TABLE "shared_host_members" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "host_id" character varying NOT NULL, "user_id" character varying NOT NULL, "added_by" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create index "shared_host_members_host_user" to table: "shared_host_members"
CREATE UNIQUE INDEX "shared_host_members_host_user" ON "shared_host_members" ("host_id", "user_id");
