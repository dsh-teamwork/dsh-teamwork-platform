-- Create "relay_hosts" table
CREATE TABLE "relay_hosts" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "user_id" character varying NOT NULL, "client_id" character varying NOT NULL, "name" character varying NOT NULL, "dsh_version" character varying NOT NULL, "last_seen_at" timestamptz NOT NULL, PRIMARY KEY ("id"));
-- Create index "relayhost_user_id_client_id" to table: "relay_hosts"
CREATE UNIQUE INDEX "relayhost_user_id_client_id" ON "relay_hosts" ("user_id", "client_id");
-- Create "relay_pairings" table
CREATE TABLE "relay_pairings" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "user_id" character varying NOT NULL, "host_id" character varying NOT NULL, "device_name" character varying NOT NULL, "device_key_hash" character varying NULL, "push_token" character varying NULL, "push_locale" character varying NULL, "confirmed_at" timestamptz NULL, "revoked_at" timestamptz NULL, "last_used_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "relaypairing_host_id" to table: "relay_pairings"
CREATE INDEX "relaypairing_host_id" ON "relay_pairings" ("host_id");
-- Create index "relaypairing_user_id" to table: "relay_pairings"
CREATE INDEX "relaypairing_user_id" ON "relay_pairings" ("user_id");
-- Create "relay_pairing_offers" table
CREATE TABLE "relay_pairing_offers" ("code_hash" character varying NOT NULL, "created_at" timestamptz NOT NULL, "host_id" character varying NOT NULL, "expires_at" timestamptz NOT NULL, "used_at" timestamptz NULL, PRIMARY KEY ("code_hash"));
-- Create index "relaypairingoffer_host_id" to table: "relay_pairing_offers"
CREATE INDEX "relaypairingoffer_host_id" ON "relay_pairing_offers" ("host_id");
-- Create "shared_hosts" table
CREATE TABLE "shared_hosts" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "team_id" character varying NOT NULL, "name" character varying NOT NULL, "key_hash" character varying NOT NULL, "identity_key" character varying NULL, "created_by" character varying NOT NULL, "bound_at" timestamptz NULL, "last_seen_at" timestamptz NULL, PRIMARY KEY ("id"));
-- Create index "sharedhost_team_id" to table: "shared_hosts"
CREATE INDEX "sharedhost_team_id" ON "shared_hosts" ("team_id");
