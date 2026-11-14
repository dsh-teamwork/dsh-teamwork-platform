-- Create "identities" table
CREATE TABLE `identities` (`id` text NOT NULL, `created_at` datetime NOT NULL, `provider` text NOT NULL, `subject` text NOT NULL, `user_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `identities_users_identities` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE);
-- Create index "identity_provider_subject" to table: "identities"
CREATE UNIQUE INDEX `identity_provider_subject` ON `identities` (`provider`, `subject`);
-- Create index "identity_user_id" to table: "identities"
CREATE INDEX `identity_user_id` ON `identities` (`user_id`);
-- Create "invites" table
CREATE TABLE `invites` (`id` text NOT NULL, `created_at` datetime NOT NULL, `token_hash` text NOT NULL, `expires_at` datetime NOT NULL, `used_at` datetime NULL, `team_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `invites_teams_invites` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE);
-- Create index "invites_token_hash_key" to table: "invites"
CREATE UNIQUE INDEX `invites_token_hash_key` ON `invites` (`token_hash`);
-- Create index "invite_team_id" to table: "invites"
CREATE INDEX `invite_team_id` ON `invites` (`team_id`);
-- Create "memberships" table
CREATE TABLE `memberships` (`id` text NOT NULL, `created_at` datetime NOT NULL, `role` text NOT NULL, `team_id` text NOT NULL, `user_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `memberships_teams_memberships` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE, CONSTRAINT `memberships_users_memberships` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE);
-- Create index "membership_user_id_team_id" to table: "memberships"
CREATE UNIQUE INDEX `membership_user_id_team_id` ON `memberships` (`user_id`, `team_id`);
-- Create index "membership_team_id" to table: "memberships"
CREATE INDEX `membership_team_id` ON `memberships` (`team_id`);
-- Create "passwords" table
CREATE TABLE `passwords` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `hash` text NOT NULL, `must_change` bool NOT NULL DEFAULT (false), `user_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `passwords_users_password` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE);
-- Create index "passwords_user_id_key" to table: "passwords"
CREATE UNIQUE INDEX `passwords_user_id_key` ON `passwords` (`user_id`);
-- Create "rate_windows" table
CREATE TABLE `rate_windows` (`id` text NOT NULL, `created_at` datetime NOT NULL, `key` text NOT NULL, `window_start` datetime NOT NULL, `count` integer NOT NULL DEFAULT (0), PRIMARY KEY (`id`));
-- Create index "rate_windows_key_key" to table: "rate_windows"
CREATE UNIQUE INDEX `rate_windows_key_key` ON `rate_windows` (`key`);
-- Create "teams" table
CREATE TABLE `teams` (`id` text NOT NULL, `created_at` datetime NOT NULL, `name` text NOT NULL, PRIMARY KEY (`id`));
-- Create "team_configs" table
CREATE TABLE `team_configs` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `kind` text NOT NULL, `name` text NOT NULL, `data` json NOT NULL, `version` integer NOT NULL DEFAULT (1), `team_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `team_configs_teams_configs` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE);
-- Create index "teamconfig_team_id_kind_name" to table: "team_configs"
CREATE UNIQUE INDEX `teamconfig_team_id_kind_name` ON `team_configs` (`team_id`, `kind`, `name`);
-- Create "team_providers" table
CREATE TABLE `team_providers` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `name` text NOT NULL, `base_url` text NOT NULL, `key_cipher` text NOT NULL, `team_id` text NOT NULL, PRIMARY KEY (`id`), CONSTRAINT `team_providers_teams_providers` FOREIGN KEY (`team_id`) REFERENCES `teams` (`id`) ON DELETE CASCADE);
-- Create index "teamprovider_team_id_name" to table: "team_providers"
CREATE UNIQUE INDEX `teamprovider_team_id_name` ON `team_providers` (`team_id`, `name`);
-- Create "users" table
CREATE TABLE `users` (`id` text NOT NULL, `created_at` datetime NOT NULL, `updated_at` datetime NOT NULL, `email` text NULL, `name` text NULL, `image` text NULL, `locale` text NULL, PRIMARY KEY (`id`));
-- Create index "users_email_key" to table: "users"
CREATE UNIQUE INDEX `users_email_key` ON `users` (`email`);
-- Create "verification_codes" table
CREATE TABLE `verification_codes` (`id` text NOT NULL, `created_at` datetime NOT NULL, `email` text NOT NULL, `code_hash` text NOT NULL, `attempts` integer NOT NULL DEFAULT (0), `expires_at` datetime NOT NULL, PRIMARY KEY (`id`));
-- Create index "verificationcode_email_created_at" to table: "verification_codes"
CREATE INDEX `verificationcode_email_created_at` ON `verification_codes` (`email`, `created_at`);
