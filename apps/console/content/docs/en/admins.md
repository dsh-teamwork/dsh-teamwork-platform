---
title: Set up a team
description: Create a team, connect a provider, publish models and presets, bring members in and set budgets.
---

A team is ready when it has a model members can call, a preset to start from,
and its members. The team's **Overview** in the console tracks these steps, and
once the team is running it opens with what waits on you: submissions to
review, budgets near their limit, calls to resolve and budget mail that failed.

## 1. Create the team

Sign in to the console and choose **Create team** on the teams page. You
become its admin. Every new team gets a **team assistant** preset.

## 2. Connect a provider and publish models

Open **Models → Add provider**. Pick a provider from the list and paste its API
key, or enter any OpenAI-compatible address under **Custom**. The key is checked
with the provider before it is saved: a key the provider refuses, or an address
this server may not call, is shown on the form with what to change. The key is
stored encrypted and can never be read back. Then tick the models the team
should use and publish them.

Members see team models only: never the address or the key.

## 3. Add presets and plugins

- **Presets** are roles the team shares: the model a preset calls, the tools it
  needs and the way it works. Start from a template or a blank preset.
- **Plugins** pin npm packages at exact versions, so everyone runs the same
  build. Members still confirm each installation in their own DSH.

Every change is published to members at their next sync and kept as a version
under **Versions and backups**.

## 4. Bring people in

Open **Members**. Depending on how the server signs people in:

- **With email sign-in**, create an invitation link. It works once, for 24 hours.
- **With passwords**, enter the person's email to create their account. Copy
  the first password shown and give it to them; it is not shown again. They sign
  in with it once and choose their own.

Send new members the [install guide](/docs/install).

A team has one admin. To hand the role to someone else, choose **Make admin**
beside them; you become a member.

## 5. Set budgets

Under **Models**, set a reference rate for each model. Then, under **Budgets**,
add daily or monthly caps for the whole team, a default for each member, or a
provider. A call reserves its largest possible cost before it runs, and one that
would pass a cap is refused. **Usage** lists every call by member and model and
exports it as CSV.

## 6. Review what members share

Members can submit presets and plugins. Under **Sharing and review**, compare
the proposed contents with what is live, then approve to publish or reject with
a reason.
