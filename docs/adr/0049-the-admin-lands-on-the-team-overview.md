# 0049. The admin lands on the team overview

> **Status:** Accepted · **Date:** 2026-11-18

## Context

ADR 0043 made the console work first: Workspace for everyone, Team management
for the admin. Its home (`/teams/{teamId}`), though, was two pages in one:
an admin saw the team's calls, reviews, unresolved usage, budget alarms and
getting started, and a member saw their own calls and limits. So an admin had
no view of their own use, a member's page carried links an admin's would
(a budget alarm opened the budgets page, which sends a member home), and
what the admin runs the team from sat in the members' workspace.

`GET /api/teams/{teamId}/summary` followed the same split: it returned the
team's figures to an admin and the caller's own to a member, with no way to
ask for the other.

## Decision

- **Workspace is the reader's own, whatever their role.** Its home moves to
  `/teams/{teamId}/home` and shows everyone, an admin included, what waits on
  them (their submissions under review, the limits that apply to them), their
  last 30 days, what the team changed lately and how DSH joins. A limit is
  said, with whom to ask, rather than linked, since a member cannot open the
  budgets page.
- **Team management opens on a team overview**, `/teams/{teamId}/overview`,
  the admin's alone: what waits on the team, its last 30 days, getting started
  until it is done, its resources and the instructions to send a new member.
- **`/teams/{teamId}` sends an admin to the overview and a member to the
  home.** A member who opens a management page is sent to the home.
- **`GET …/summary` is the caller's own by default**; `scope=team` is the
  team's and needs an admin (`admin_required` otherwise). The sidebar marks the
  team overview while anything waits on the team.

## Consequences

- An admin sees their own calls and budget for the first time, and a member's
  home has no link that leads nowhere.
- The team's figures are read once in the team's layout, by an admin only; the
  home reads its own.
- Links to `/teams/{teamId}` keep working, through the redirect; a bookmark to
  it now opens the overview for an admin.
- Rejected: one home with a toggle between "mine" and "the team's", which
  keeps the admin's work in the members' workspace that ADR 0043 set apart.
