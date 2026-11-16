# System management

> **Status:** Current · **Updated:** 2026-11-15

Platform owns instance administration; editions extend its guarded API and shared console instead of maintaining a second user-management implementation.

## Service roles

`SERVICE_ROLE` is `combined` (default), `user`, or `manage`; any other value fails startup. Community installations use `/manage` for the console in either combined or management mode. `ADMIN_EMAILS` is a comma-separated instance administrator allowlist, independent of team roles; without it no management routes are registered. No first account automatically becomes an instance administrator.

| Role | Serves | Background work |
| --- | --- | --- |
| `combined` | User routes, authentication, and enabled instance management | User maintenance |
| `user` | User routes and authentication; management API and `/manage` return 404 | User maintenance |
| `manage` | Instance management and authentication; no team API, plugin authorization or model gateway | No usage maintenance |

Set `APP_URL` to the actual origin. Separate processes share `DATABASE_URL` and the provider encryption secret, but use distinct `AUTH_SECRET` values and host-only cookies. Run the user service for usage recovery and notification work. Configuration changes require process restart; the process reads its supplied administrator/key provider on every request.

The community administrator can use the configured Google, email-code or local password door. The initial password setup link still creates the first account; add that email to `ADMIN_EMAILS` explicitly. An account required to change its password cannot access management before doing so. Team administrators cannot create initial passwords for allowlisted addresses or reset their passwords. On split community deployments, configure the same `ADMIN_EMAILS` on the user process to reserve those accounts too; `SERVICE_ROLE=user` still refuses all management routes. Only allowlist accounts whose existing credentials the operator trusts.

## Capabilities and boundary

The overview counts all users, seven-day registrations and teams. Users can be searched by email/name and their display names corrected. Teams can be searched by name, exact ID or member email; the detail lists paginated membership. System diagnostics show the service role, database dialect and boolean configuration states, never credentials, connection strings or provider keys.

`GET /api/admin` describes the registered route set. Reads and ordinary writes accept an allowlisted session or `MANAGE_API_KEY`; key writes require `x-agent-id`. A supplied invalid key never falls back to cookies. Cookie writes require same origin and JSON. Management permissions do not grant access to private conversation content or disclose team provider secrets. Ordinary account mutations are attributed in service logs; this is not a full audit-event store.

Account suspension, individual session/token revocation, team lifecycle writes and a searchable audit log are not implemented by this slice.

## Edition composition

`server/manage` owns authentication guards, common routes and embedded community assets. `apps/manage` exports the shell, base-path handling and shared components through `@dsh-teamwork/manage-core`. `Host.AddAdminRoutes` adds routes under the same guard and index. `GoogleOnly` financial routes require an actual allowlisted Google session even when an automation key is otherwise valid. `Host.SetAdminConsole` selects edition assets, base path and session-door restriction. Editions must disable user-only mounts and workers on the management role; shared financial participants may still register for operator recovery.

The role is a server boundary, not merely a navigation flag. Tests exercise both forbidden surfaces with valid credentials, ordinary administrator authentication, key precedence, CSRF, search and pagination.

`mountAdmin` accepts `teamActions(team)` to place edition-owned navigation beside each team and in its detail header. The community default adds no action; the shared directory owns search and membership rendering.
