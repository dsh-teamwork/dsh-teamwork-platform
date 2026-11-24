-- Pages become artifacts and plugin archives packages (docs/adr/0069-pages-become-artifacts.md).
-- Tables are renamed, not recreated, so their rows stay.
-- Drop the markdown kind's artifacts, which knowledge takes over (ADR 0068)
DELETE FROM `page_files` WHERE `version_id` IN (SELECT `id` FROM `page_versions` WHERE `page_id` IN (SELECT `id` FROM `pages` WHERE `kind` = 'markdown'));
DELETE FROM `page_versions` WHERE `page_id` IN (SELECT `id` FROM `pages` WHERE `kind` = 'markdown');
DELETE FROM `page_members` WHERE `page_id` IN (SELECT `id` FROM `pages` WHERE `kind` = 'markdown');
DELETE FROM `pages` WHERE `kind` = 'markdown';
-- Rename "pages" table to "artifacts"
ALTER TABLE `pages` RENAME TO `artifacts`;
DROP INDEX `page_team_id_owner_id_updated_at`;
CREATE INDEX `artifact_team_id_owner_id_updated_at` ON `artifacts` (`team_id`, `owner_id`, `updated_at`);
DROP INDEX `page_team_id_sharing_updated_at`;
CREATE INDEX `artifact_team_id_sharing_updated_at` ON `artifacts` (`team_id`, `sharing`, `updated_at`);
-- Rename "page_files" table to "artifact_files"
ALTER TABLE `page_files` RENAME TO `artifact_files`;
DROP INDEX `pagefile_version_id_path`;
CREATE UNIQUE INDEX `artifactfile_version_id_path` ON `artifact_files` (`version_id`, `path`);
DROP INDEX `pagefile_team_id_digest`;
CREATE INDEX `artifactfile_team_id_digest` ON `artifact_files` (`team_id`, `digest`);
-- Rename "page_members" table to "artifact_members"
ALTER TABLE `page_members` RENAME TO `artifact_members`;
ALTER TABLE `artifact_members` RENAME COLUMN `page_id` TO `artifact_id`;
DROP INDEX `pagemember_page_id_user_id`;
CREATE UNIQUE INDEX `artifactmember_artifact_id_user_id` ON `artifact_members` (`artifact_id`, `user_id`);
DROP INDEX `pagemember_user_id_page_id`;
CREATE INDEX `artifactmember_user_id_artifact_id` ON `artifact_members` (`user_id`, `artifact_id`);
-- Rename "page_versions" table to "artifact_versions"
ALTER TABLE `page_versions` RENAME TO `artifact_versions`;
ALTER TABLE `artifact_versions` RENAME COLUMN `page_id` TO `artifact_id`;
DROP INDEX `pageversion_page_id_number`;
CREATE UNIQUE INDEX `artifactversion_artifact_id_number` ON `artifact_versions` (`artifact_id`, `number`);
-- Rename "resource_artifacts" table to "plugin_packages"
ALTER TABLE `resource_artifacts` RENAME TO `plugin_packages`;
DROP INDEX `resourceartifact_team_id_package_version`;
CREATE UNIQUE INDEX `pluginpackage_team_id_package_version` ON `plugin_packages` (`team_id`, `package`, `version`);
DROP INDEX `resourceartifact_team_id_author_id`;
CREATE INDEX `pluginpackage_team_id_author_id` ON `plugin_packages` (`team_id`, `author_id`);
-- A plugin's data names its package as packageId
UPDATE `team_configs` SET `data` = json_set(json_remove(`data`, '$.artifactId'), '$.packageId', json_extract(`data`, '$.artifactId')) WHERE json_extract(`data`, '$.artifactId') IS NOT NULL;
UPDATE `config_revisions` SET `data` = json_set(json_remove(`data`, '$.artifactId'), '$.packageId', json_extract(`data`, '$.artifactId')) WHERE json_extract(`data`, '$.artifactId') IS NOT NULL;
UPDATE `resource_submissions` SET `proposal` = json_set(json_remove(`proposal`, '$.data.artifactId'), '$.data.packageId', json_extract(`proposal`, '$.data.artifactId')) WHERE json_extract(`proposal`, '$.data.artifactId') IS NOT NULL;
-- A preset names the plugin's publishing tool teamwork_artifact
UPDATE `team_configs` SET `data` = replace(`data`, '"teamwork_page"', '"teamwork_artifact"') WHERE `data` LIKE '%"teamwork_page"%';
UPDATE `config_revisions` SET `data` = replace(`data`, '"teamwork_page"', '"teamwork_artifact"') WHERE `data` LIKE '%"teamwork_page"%';
UPDATE `resource_submissions` SET `proposal` = replace(`proposal`, '"teamwork_page"', '"teamwork_artifact"') WHERE `proposal` LIKE '%"teamwork_page"%';
