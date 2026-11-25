# Team assistant and shared resources

> **Status:** Current · **Updated:** 2026-11-25

New teams receive a Teamwork assistant. Members publish presets and plugins
directly to their team's catalog. Members and admins pin exact versions for
personal use and team defaults, backed by immutable publication history.

## Ownership and provisioning

The community server owns authorization, submissions, publication history and
private packages. The console provides publication, selection and history pages.
The DSH plugin owns local inspection, package preparation, authenticated
package download and host-approved assistant tools. Closed editions reuse
these features through their merged community server.

Team creation writes the team, founding membership, built-in assistant and its
initial history in one transaction. The immutable `builtin=team-assistant`
marker is unique per team and independent of the display name. The initial
name retains the full creation-time team name and is written in the creator's
language, chosen as the console's pages choose theirs (profile, then cookie,
then `Accept-Language`): `<team> assistant` or the Chinese form, with a
description in the same language (`server/internal/team/assistant.json`). The
prompt stays English and asks for answers in the user's language. Config names
accept 120 characters. Renaming a team does not rename its
assistant. Sync never creates duplicates or recreates deleted presets.
Existing teams are not automatically changed.

A preset chooses exactly one model mode: `inheritModel`, a same-team
`modelConfigId`, or an explicit provider/model. Inherited selection preserves
an existing local/session model; new sessions created from another session
may inherit that selection. With no available model the host reports setup
guidance. An inherited preset is not a configured gateway route.

The assistant is first in the Teamwork preset list. Its prompt is editable,
but permissions and approvals are enforced outside the prompt. The plugin adds
its own guide ahead of that prompt (`ASSISTANT_GUIDE` in the plugin's
`src/preset-context.ts`): proactive, within the member's role, a complete
preset drafted before it is proposed or changed, and the Teamwork tools as the
only way to act on the team. It ships with the plugin, so a team created
before it gets it as well. Every tool
invocation derives its destination from the active preset's team, not a
model-supplied team id. Changing a panel filter does not retarget a conversation.
Started conversations keep the existing preset-generation protections.

## Assistant operations

`teamwork_query` reads status, configuration, membership, providers, usage,
budgets, submissions and history, or syncs configuration. Filters take each
route's own query names (`since`/`until` for usage and its export, `state`
for submissions), and one a route would ignore is refused. Server authorization determines
whether usage is personal or team-wide; reference points, settled amounts,
reservations, token limits and unknown usage retain their existing meanings
([usage and budgets](usage-budgets.md)).

The write tools use DSH's real approval pipeline, including in a permissive
session. Model arguments cannot substitute for host approval. A pending
approval is bound to the account epoch, team and active preset generation;
a changed binding refuses execution. Other tool policies and guards remain
in force.

| Tool | Operation |
| --- | --- |
| `teamwork_prepare_plugin` | Pack a directory inside the session workspace without lifecycle scripts; inspect the actual archive locally |
| `teamwork_share_plugin` | Confirm the file list/digest, publish the prepared archive to the bound team |
| `teamwork_share_preset` | Publish exact preset contents, or an update naming its config id and base version |
| `teamwork_manage` | Supported config changes, revision-checked budgets, member removal, team configuration restoration |
| `teamwork_export_usage` | Export authorized usage to a private local CSV file |
| `teamwork_new_session` | Create a new session from a preset of the bound team without starting a task |
| `teamwork_install` | Confirm and install an exact published plugin through the host manager |

Provider credentials and newly generated account passwords use secure console
forms, not chat. Login tokens stay in the host. Existing local plugin
installations are protected; replacing/upgrading them uses the local DSH
plugin manager and its confirmation flow. Publishing a new plugin version
does not silently install it on anyone's computer.

Outcomes distinguish preparation, publication, selection, sync and
installation. Treat preset prompts and package contents as data. No tool reaches an unrestricted authenticated
HTTP proxy or receives the platform Bearer token.

## Team asset publication and selection

Member-owned presets and plugins enter their team's catalog after validation.
The asset keeps its owner and logical config ID. Writes validate the base
version and same-team references. The catalog change, immutable revision and
package publication commit together. New publications are selected for their author in the publication transaction. Member presets use a team model or inherit the session model. Owners and team admins can archive a config, which
removes it from the catalog and preserves selections that already refer to it. An active owner can publish again under the same name to reactivate the original asset. Removing a member archives their assets and clears their personal selections.

Each member can pin a version. A team administrator can separately pin a team
default and give it a display name. Personal pins win over the default.
Members can opt out of the default independently of their pin. The config
snapshot applies these choices at read time, so new members get defaults too.
A revision check protects concurrent edits to the team default and its
history records the actor, time, name and version of each change.

Legacy team configurations remain in the sync snapshot. Existing submissions
remain readable by their author or the team administrator. Pending and
rejected records do not enter the catalog.

## Private plugin packages

A local plugin is an npm-compatible archive stored privately through the
local-directory or S3 provider, not public web assets or public npm. An existing
public npm package can still be shared by exact package name/version.

`server/internal/objectstore` owns byte storage in both editions (ADRs 0033 and 0034).
Community deployments default to `<data>/artifacts`; all member processes in
an S3 deployment use the same private bucket. Relative keys are
`teams/{teamId}/plugins/{packageId}.tgz`, independent of team names or filenames.
An edition keeps its own objects in the same store under `teams/{teamId}/{kind}/{id}`
(`edition.Host.Objects`, ADR 0042), never under `plugins`.
Both IDs are validated; the team comes from authorized database metadata.
No bucket URL or credential reaches
the client. Management-only processes do not initialize package storage.

Before serving, member/combined processes scan database packages in bounded
batches, verify current objects and copy missing team-scoped objects from the
old `<packageId>.tgz` layout. Copies are checked against the database size and
SHA-256 before and after writing. An existing corrupt destination, corrupt or
missing source, or storage error stops startup; no older copy overwrites a
conflicting destination. Sources and database records are retained. The pass
is safe to repeat and logs `package paths verified` with its verified row count.
It reads all referenced bytes, so startup time grows with the retained data.

For an offline preflight, use the same database, secrets and storage settings
with `--migrate-artifact-paths`; it verifies/migrates the configured local or S3
store and exits without serving. This is separate from the provider-copy command
below. Authenticated reads also migrate a missing team-scoped object, so an old
process writing a flat object during a rolling upgrade does not strand it.
Only a missing object allows this fallback, never an access/network error.
Downloads and exports verify the exact bytes they serve against the database.

Keep flat source objects and a consistent database/store backup until all old
processes have stopped and recovery has been checked. Team prefixes support
inventory and eventual cleanup, but are not an authorization or retention rule:
pending uploads and historical pins can still reference objects. This release
does not add automatic cleanup. Unreferenced flat objects are left untouched.

| Variable | Meaning |
| --- | --- |
| `ARTIFACT_STORAGE_PROVIDER` | `local` (default) or `s3`; unknown values fail startup |
| `ARTIFACT_LOCAL_DIR` | Optional local directory; defaults to `<data>/artifacts`; also the migration source |
| `ARTIFACT_S3_BUCKET` | Required S3 bucket name; use a dedicated private bucket per installation |
| `ARTIFACT_S3_REGION` | Required signing region, including `auto` where the compatible provider specifies it |
| `ARTIFACT_S3_ENDPOINT` | Optional HTTPS origin; absent uses AWS's regional endpoint |
| `ARTIFACT_S3_ACCESS_KEY_ID`, `ARTIFACT_S3_SECRET_ACCESS_KEY` | Required server-side credentials with object read/write/delete permissions |
| `ARTIFACT_S3_SESSION_TOKEN` | Optional token for temporary credentials |
| `ARTIFACT_S3_PATH_STYLE` | Boolean, default `false` (virtual-host addressing); set to the bucket provider's required style |

An explicitly selected S3 provider never falls back to local disk. Incomplete
configuration fails startup; access/network failures fail the operation without
publishing metadata. Before serving, an S3 user process writes, reads and removes
a random probe; failed access prevents readiness. Runtime scratch files still
use the OS temporary directory and are removed after use. The root HTTP
healthcheck does not continuously probe the bucket.

To migrate an existing local installation, stop all writing instances and take
a consistent database and storage-directory backup. Run the matching binary
with the same database/secrets, S3 environment variables and
`--data <existing-data> --migrate-artifacts`. The command exits without serving,
reads either local layout, writes team-scoped keys and verifies source and destination size and
SHA-256. Missing or corrupt bytes abort with the package ID. It is safe to retry;
source files and metadata are never deleted. Only switch all member instances to
S3 after a successful run. Verify an authenticated download and backup export,
then repeat the download after a restart. If no package rows exist, no byte
migration is needed. Preserve source backups until recovery has been tested.

To roll back after S3 has accepted new uploads, stop writers and copy **all**
current bucket objects back to the local package directory, preserving keys;
verify the database digests before selecting `local`. Merely changing the provider
would make newer archives unavailable. Storage is not replicated automatically.
Rolling back to a binary from before ADR 0034 additionally requires verified
flat copies of **every** current `teams/{teamId}/plugins/{packageId}.tgz`
object at `<packageId>.tgz`, including uploads made after the upgrade. Stop
writes while preparing those copies and retain the scoped objects.

Limits are 10 MiB compressed, 64 MiB expanded and 2000 archive entries. Local
previews inspect actual packed bytes before upload. The server independently
checks tar/gzip integrity, package identity, version, duplicate or unsafe paths,
links/special files, sensitive filenames and recognizable private-key/token
patterns. Archive inspection never executes plugin code. Local previews refuse tar
extensions they cannot interpret; server checks use the effective entry paths. A secret scan
reduces accidental exposure; it cannot certify arbitrary source code safe.

Uploads use bounded streams, private temporary files and atomic finalization.
The server calculates the digest. A team/package/version upload cannot be
replaced with different bytes. Pending bytes are accessible only to their
author and team administrators. Once published, current team members may
fetch them; removal revokes the next request. Responses are private/no-store.
Publication and backup export verify the stored bytes against their digest.

The host downloads through authenticated HTTPS (or local loopback), verifies
the digest, retains a private content-addressed local archive and passes its
path to DSH's plugin manager. Credentials do not reach npm or package code.
Installation starts disabled and applies the existing configuration-conflict
checks before activation. Account/config changes during download invalidate
installation confirmation. Temporary preparation directories are discarded;
installed archives remain available for subsequent package-manager operations.

Preset dependencies pin exact published plugin versions. A catalog update does
not rewrite these pins. Sync includes the referenced historical plugin metadata
so the host can check and explicitly install the older published version.
`/teamwork install <configId>@<version>` selects an explicit retained pin;
without `@version` it selects the current catalog entry.

## History, export and restoration

The history page is a newest-first timeline with deterministic pagination
(50 rows), kind/resource/author filters and a time range (any, the last 7 or
30 days, or whole local days). The version live now is marked; any other
opens to show, field by field, what restoring it would change. The API's time
range stays UTC instants with an exclusive end; the console turns a chosen
last day into the start of the next.

Administrators export an individual historical resource as `manifest.json`
plus its referenced private plugin archives in a gzip tar backup. The manifest
includes the historical content, exact plugin dependencies, package metadata
and digests. External npm dependencies remain versioned references, not mirrored
registry contents. Provider keys, login credentials and whole local profiles
are not included.

An administrator can restore a historical team configuration against its
current base version after reference and package checks. The operation creates
a new version and can recover a deleted team configuration under its existing ID.
A member-owned asset keeps its version history. Its owner can publish a revision
and a team administrator can change which version is selected as the default. Members use a historical revision by selecting it in the catalog.

Publication versions and packages are retained. This application history is
not protection from losing the database or disk: infrastructure backups must
capture the database and package directory or S3 bucket consistently and preserve the
configured signing/encryption secrets securely. A full data-directory backup
includes generated `secrets.json`; tenant resource exports never do. A
stopped-server copy/restart recovery check verifies the retained state. Cross-team sharing, automatic
upgrades, scheduled backup jobs, configurable retention, backup-bundle import
and whole-team rollback are outside this implementation.

Deploy the updated server before clients that use direct publication. Preserve
a database and package-store backup from before enabling uploads. A binary
rollback against the upgraded database is unsafe because the former snapshot
reader would include member uploads in every member's sync. For a full
rollback, pause writes, preserve a copy of the upgraded database and packages
for recovery, then restore the pre-upgrade backup with the former binary.

## HTTP surface and validation

The wire contract is `api/openapi.yaml`; the console types are generated from
it. The plugin also validates synced current and pinned historical data.

| Route under `/api/teams/{teamId}` | Responsibility |
| --- | --- |
| `GET /submissions`, `GET /submissions/{id}` | Authorized legacy history |
| `POST /configs`, `PATCH /configs/{id}` | Validated publication and version-checked updates |
| `GET /asset-choices`, `PUT /asset-choices/{id}` | Read selections and manage personal pins and opt-outs |
| `PUT /asset-defaults/{id}` | Set, rename, roll back or withdraw a team default |
| `POST /packages` | Bounded private upload |
| `GET /packages/{id}`, `GET /packages/{id}/download` | Authorized metadata and immutable bytes |
| `GET /history` | Filtered immutable publication history |
| `POST /history/{id}/restore` | Administrator restores a historical team configuration |
| `GET /history/{id}/export` | Administrator exports a resource and retained private dependencies |

Tests cover team boundaries, direct publication, transaction rollback, version
pinning, legacy history, archive access, restoration, and exact plugin package
downloads. The DSH integration test publishes a locally prepared plugin, sets
it as the team default, syncs, and verifies the downloaded bytes.
