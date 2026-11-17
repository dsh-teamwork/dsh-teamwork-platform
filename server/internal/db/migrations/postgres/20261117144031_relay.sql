-- Create "relay_hosts" table
CREATE TABLE "relay_hosts" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "user_id" character varying NOT NULL, "client_id" character varying NOT NULL, "name" character varying NOT NULL, "dsh_version" character varying NOT NULL, "last_seen_at" timestamptz NOT NULL, PRIMARY KEY ("id"));
-- Create index "relay_hosts_user_client" to table: "relay_hosts"
CREATE UNIQUE INDEX "relay_hosts_user_client" ON "relay_hosts" ("user_id", "client_id");
-- Create "relay_pairings" table
CREATE TABLE "relay_pairings" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "user_id" character varying NOT NULL, "host_id" character varying NOT NULL, "device_name" character varying NOT NULL, "device_key_hash" character varying NULL, "push_token" character varying NULL, "push_locale" character varying NULL, "confirmed_at" timestamptz NULL, "revoked_at" timestamptz NULL, "last_used_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "relay_pairings_host" to table: "relay_pairings"
CREATE INDEX "relay_pairings_host" ON "relay_pairings" ("host_id");
-- Create index "relay_pairings_user" to table: "relay_pairings"
CREATE INDEX "relay_pairings_user" ON "relay_pairings" ("user_id");
-- Create "relay_pairing_offers" table
CREATE TABLE "relay_pairing_offers" ("code_hash" character varying NOT NULL, "created_at" timestamptz NOT NULL, "host_id" character varying NOT NULL, "expires_at" timestamptz NOT NULL, "used_at" timestamptz NULL, PRIMARY KEY ("code_hash"));
-- Create index "relay_pairing_offers_host" to table: "relay_pairing_offers"
CREATE INDEX "relay_pairing_offers_host" ON "relay_pairing_offers" ("host_id");
-- Create "shared_hosts" table
CREATE TABLE "shared_hosts" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "name" character varying NOT NULL, "key_hash" character varying NOT NULL, "identity_key" character varying NULL, "created_by" character varying NOT NULL, "bound_at" timestamptz NULL, "last_seen_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "shared_hosts_team" to table: "shared_hosts"
CREATE INDEX "shared_hosts_team" ON "shared_hosts" ("team_id");
