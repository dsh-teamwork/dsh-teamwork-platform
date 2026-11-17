-- Create "relay_hosts" table
CREATE TABLE `relay_hosts` (`id` text NOT NULL, `created_at` datetime NOT NULL, `user_id` text NOT NULL, `client_id` text NOT NULL, `name` text NOT NULL, `dsh_version` text NOT NULL, `last_seen_at` datetime NOT NULL, PRIMARY KEY (`id`));
-- Create index "relay_hosts_user_client" to table: "relay_hosts"
CREATE UNIQUE INDEX `relay_hosts_user_client` ON `relay_hosts` (`user_id`, `client_id`);
-- Create "relay_pairings" table
CREATE TABLE `relay_pairings` (`id` text NOT NULL, `created_at` datetime NOT NULL, `user_id` text NOT NULL, `host_id` text NOT NULL, `device_name` text NOT NULL, `device_key_hash` text NULL, `push_token` text NULL, `push_locale` text NULL, `confirmed_at` datetime NULL, `revoked_at` datetime NULL, `last_used_at` datetime NULL, PRIMARY KEY (`id`));
-- Create index "relay_pairings_user" to table: "relay_pairings"
CREATE INDEX `relay_pairings_user` ON `relay_pairings` (`user_id`);
-- Create index "relay_pairings_host" to table: "relay_pairings"
CREATE INDEX `relay_pairings_host` ON `relay_pairings` (`host_id`);
-- Create "relay_pairing_offers" table
CREATE TABLE `relay_pairing_offers` (`code_hash` text NOT NULL, `created_at` datetime NOT NULL, `host_id` text NOT NULL, `expires_at` datetime NOT NULL, `used_at` datetime NULL, PRIMARY KEY (`code_hash`));
-- Create index "relay_pairing_offers_host" to table: "relay_pairing_offers"
CREATE INDEX `relay_pairing_offers_host` ON `relay_pairing_offers` (`host_id`);
-- Create "shared_hosts" table
CREATE TABLE `shared_hosts` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `name` text NOT NULL, `key_hash` text NOT NULL, `identity_key` text NULL, `created_by` text NOT NULL, `bound_at` datetime NULL, `last_seen_at` datetime NULL, PRIMARY KEY (`id`));
-- Create index "shared_hosts_team" to table: "shared_hosts"
CREATE INDEX `shared_hosts_team` ON `shared_hosts` (`team_id`);
