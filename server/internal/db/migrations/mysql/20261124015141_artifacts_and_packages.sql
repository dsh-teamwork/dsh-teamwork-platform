-- Pages become artifacts and plugin archives packages (docs/adr/0069-pages-become-artifacts.md).
-- Tables are renamed, not recreated, so their rows stay.
-- Drop the markdown kind's artifacts, which knowledge takes over (ADR 0068)
DELETE FROM `page_files` WHERE `version_id` IN (SELECT `id` FROM `page_versions` WHERE `page_id` IN (SELECT `id` FROM `pages` WHERE `kind` = 'markdown'));
DELETE FROM `page_versions` WHERE `page_id` IN (SELECT `id` FROM `pages` WHERE `kind` = 'markdown');
DELETE FROM `page_members` WHERE `page_id` IN (SELECT `id` FROM `pages` WHERE `kind` = 'markdown');
DELETE FROM `pages` WHERE `kind` = 'markdown';
-- Rename "pages" table to "artifacts"
RENAME TABLE `pages` TO `artifacts`;
ALTER TABLE `artifacts` MODIFY COLUMN `kind` enum('html','svg') NOT NULL, RENAME INDEX `page_team_id_owner_id_updated_at` TO `artifact_team_id_owner_id_updated_at`, RENAME INDEX `page_team_id_sharing_updated_at` TO `artifact_team_id_sharing_updated_at`;
-- Rename "page_files" table to "artifact_files"
RENAME TABLE `page_files` TO `artifact_files`;
ALTER TABLE `artifact_files` RENAME INDEX `pagefile_version_id_path` TO `artifactfile_version_id_path`, RENAME INDEX `pagefile_team_id_digest` TO `artifactfile_team_id_digest`;
-- Rename "page_members" table to "artifact_members"
RENAME TABLE `page_members` TO `artifact_members`;
ALTER TABLE `artifact_members` RENAME COLUMN `page_id` TO `artifact_id`, RENAME INDEX `pagemember_page_id_user_id` TO `artifactmember_artifact_id_user_id`, RENAME INDEX `pagemember_user_id_page_id` TO `artifactmember_user_id_artifact_id`;
-- Rename "page_versions" table to "artifact_versions"
RENAME TABLE `page_versions` TO `artifact_versions`;
ALTER TABLE `artifact_versions` RENAME COLUMN `page_id` TO `artifact_id`, RENAME INDEX `pageversion_page_id_number` TO `artifactversion_artifact_id_number`;
-- Rename "resource_artifacts" table to "plugin_packages"
RENAME TABLE `resource_artifacts` TO `plugin_packages`;
ALTER TABLE `plugin_packages` RENAME INDEX `resourceartifact_team_id_package_version` TO `pluginpackage_team_id_package_version`, RENAME INDEX `resourceartifact_team_id_author_id` TO `pluginpackage_team_id_author_id`;
-- A plugin's data names its package as packageId
UPDATE `team_configs` SET `data` = JSON_SET(JSON_REMOVE(`data`, '$.artifactId'), '$.packageId', JSON_EXTRACT(`data`, '$.artifactId')) WHERE JSON_CONTAINS_PATH(`data`, 'one', '$.artifactId');
UPDATE `config_revisions` SET `data` = JSON_SET(JSON_REMOVE(`data`, '$.artifactId'), '$.packageId', JSON_EXTRACT(`data`, '$.artifactId')) WHERE JSON_CONTAINS_PATH(`data`, 'one', '$.artifactId');
UPDATE `resource_submissions` SET `proposal` = JSON_SET(JSON_REMOVE(`proposal`, '$.data.artifactId'), '$.data.packageId', JSON_EXTRACT(`proposal`, '$.data.artifactId')) WHERE JSON_CONTAINS_PATH(`proposal`, 'one', '$.data.artifactId');
-- A preset names the plugin's publishing tool teamwork_artifact
UPDATE `team_configs` SET `data` = CAST(REPLACE(CAST(`data` AS CHAR), '"teamwork_page"', '"teamwork_artifact"') AS JSON) WHERE CAST(`data` AS CHAR) LIKE '%"teamwork_page"%';
UPDATE `config_revisions` SET `data` = CAST(REPLACE(CAST(`data` AS CHAR), '"teamwork_page"', '"teamwork_artifact"') AS JSON) WHERE CAST(`data` AS CHAR) LIKE '%"teamwork_page"%';
UPDATE `resource_submissions` SET `proposal` = CAST(REPLACE(CAST(`proposal` AS CHAR), '"teamwork_page"', '"teamwork_artifact"') AS JSON) WHERE CAST(`proposal` AS CHAR) LIKE '%"teamwork_page"%';
