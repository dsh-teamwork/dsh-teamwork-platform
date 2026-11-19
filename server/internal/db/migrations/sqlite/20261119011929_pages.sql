-- Create "pages" table
CREATE TABLE `pages` (`id` text NOT NULL, `created_at` datetime NOT NULL, `team_id` text NOT NULL, `owner_id` text NOT NULL, `kind` text NOT NULL, `title` text NOT NULL, `sharing` text NOT NULL DEFAULT ('private'), `current_version` integer NOT NULL, `updated_at` datetime NOT NULL, PRIMARY KEY (`id`));
-- Create index "page_team_id_owner_id_updated_at" to table: "pages"
CREATE INDEX `page_team_id_owner_id_updated_at` ON `pages` (`team_id`, `owner_id`, `updated_at`);
-- Create index "page_team_id_sharing_updated_at" to table: "pages"
CREATE INDEX `page_team_id_sharing_updated_at` ON `pages` (`team_id`, `sharing`, `updated_at`);
-- Create "page_files" table
CREATE TABLE `page_files` (`id` text NOT NULL, `created_at` datetime NOT NULL, `version_id` text NOT NULL, `team_id` text NOT NULL, `path` text NOT NULL, `content_type` text NOT NULL, `size` integer NOT NULL, `digest` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "pagefile_version_id_path" to table: "page_files"
CREATE UNIQUE INDEX `pagefile_version_id_path` ON `page_files` (`version_id`, `path`);
-- Create index "pagefile_team_id_digest" to table: "page_files"
CREATE INDEX `pagefile_team_id_digest` ON `page_files` (`team_id`, `digest`);
-- Create "page_members" table
CREATE TABLE `page_members` (`id` text NOT NULL, `created_at` datetime NOT NULL, `page_id` text NOT NULL, `user_id` text NOT NULL, `added_by` text NOT NULL, PRIMARY KEY (`id`));
-- Create index "pagemember_page_id_user_id" to table: "page_members"
CREATE UNIQUE INDEX `pagemember_page_id_user_id` ON `page_members` (`page_id`, `user_id`);
-- Create index "pagemember_user_id_page_id" to table: "page_members"
CREATE INDEX `pagemember_user_id_page_id` ON `page_members` (`user_id`, `page_id`);
-- Create "page_versions" table
CREATE TABLE `page_versions` (`id` text NOT NULL, `created_at` datetime NOT NULL, `page_id` text NOT NULL, `number` integer NOT NULL, `author_id` text NOT NULL, `host_id` text NOT NULL DEFAULT (''), `computer` text NOT NULL DEFAULT (''), `session_id` text NOT NULL DEFAULT (''), `note` text NOT NULL DEFAULT (''), `size` integer NOT NULL, PRIMARY KEY (`id`));
-- Create index "pageversion_page_id_number" to table: "page_versions"
CREATE UNIQUE INDEX `pageversion_page_id_number` ON `page_versions` (`page_id`, `number`);
