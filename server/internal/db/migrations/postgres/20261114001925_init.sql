-- Create "rate_windows" table
CREATE TABLE "rate_windows" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "key" character varying NOT NULL, "window_start" timestamptz NOT NULL, "count" bigint NOT NULL DEFAULT 0, PRIMARY KEY ("id"));
-- Create index "rate_windows_key_key" to table: "rate_windows"
CREATE UNIQUE INDEX "rate_windows_key_key" ON "rate_windows" ("key");
-- Create "users" table
CREATE TABLE "users" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "email" character varying NULL, "name" character varying NULL, "image" character varying NULL, "locale" character varying NULL, PRIMARY KEY ("id"));
-- Create index "users_email_key" to table: "users"
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
-- Create "verification_codes" table
CREATE TABLE "verification_codes" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "email" character varying NOT NULL, "code_hash" character varying NOT NULL, "attempts" bigint NOT NULL DEFAULT 0, "expires_at" timestamptz NOT NULL, PRIMARY KEY ("id"));
-- Create index "verificationcode_email_created_at" to table: "verification_codes"
CREATE INDEX "verificationcode_email_created_at" ON "verification_codes" ("email", "created_at");
-- Create "identities" table
CREATE TABLE "identities" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "provider" character varying NOT NULL, "subject" character varying NOT NULL, "user_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "identities_users_identities" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "identity_provider_subject" to table: "identities"
CREATE UNIQUE INDEX "identity_provider_subject" ON "identities" ("provider", "subject");
-- Create index "identity_user_id" to table: "identities"
CREATE INDEX "identity_user_id" ON "identities" ("user_id");
-- Create "teams" table
CREATE TABLE "teams" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "name" character varying NOT NULL, PRIMARY KEY ("id"));
-- Create "invites" table
CREATE TABLE "invites" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "token_hash" character varying NOT NULL, "expires_at" timestamptz NOT NULL, "used_at" timestamptz NULL, "team_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "invites_teams_invites" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "invite_team_id" to table: "invites"
CREATE INDEX "invite_team_id" ON "invites" ("team_id");
-- Create index "invites_token_hash_key" to table: "invites"
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites" ("token_hash");
-- Create "memberships" table
CREATE TABLE "memberships" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "role" character varying NOT NULL, "team_id" character varying NOT NULL, "user_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "memberships_teams_memberships" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE, CONSTRAINT "memberships_users_memberships" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "membership_team_id" to table: "memberships"
CREATE INDEX "membership_team_id" ON "memberships" ("team_id");
-- Create index "membership_user_id_team_id" to table: "memberships"
CREATE UNIQUE INDEX "membership_user_id_team_id" ON "memberships" ("user_id", "team_id");
-- Create "passwords" table
CREATE TABLE "passwords" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "hash" character varying NOT NULL, "must_change" boolean NOT NULL DEFAULT false, "failures" bigint NOT NULL DEFAULT 0, "failures_since" timestamptz NULL, "user_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "passwords_users_password" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "passwords_user_id_key" to table: "passwords"
CREATE UNIQUE INDEX "passwords_user_id_key" ON "passwords" ("user_id");
-- Create "team_configs" table
CREATE TABLE "team_configs" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "kind" character varying NOT NULL, "name" character varying NOT NULL, "data" jsonb NOT NULL, "version" bigint NOT NULL DEFAULT 1, "team_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "team_configs_teams_configs" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "teamconfig_team_id_kind_name" to table: "team_configs"
CREATE UNIQUE INDEX "teamconfig_team_id_kind_name" ON "team_configs" ("team_id", "kind", "name");
-- Create "team_providers" table
CREATE TABLE "team_providers" ("id" character varying NOT NULL, "created_at" timestamptz NOT NULL, "updated_at" timestamptz NOT NULL, "name" character varying NOT NULL, "base_url" character varying NOT NULL, "key_cipher" text NOT NULL, "team_id" character varying NOT NULL, PRIMARY KEY ("id"), CONSTRAINT "team_providers_teams_providers" FOREIGN KEY ("team_id") REFERENCES "teams" ("id") ON UPDATE NO ACTION ON DELETE CASCADE);
-- Create index "teamprovider_team_id_name" to table: "team_providers"
CREATE UNIQUE INDEX "teamprovider_team_id_name" ON "team_providers" ("team_id", "name");
