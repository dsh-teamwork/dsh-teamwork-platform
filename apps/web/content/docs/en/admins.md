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

When publishing or editing a model, **Get model information** queries Models.dev
or OpenRouter immediately. Choose the reference provider/model, review the
changes and apply context limits and image understanding to the form. A custom
call ID stays unchanged. Unknown fields retain your entries, and failed lookups
do not stop manual configuration. Save separately to publish the values.

In a model's reference-rate dialog, while the rate is an estimated cost rather
than an internal weight, **Get suggested prices** converts public
prices to CNY automatically using the latest available reference exchange rate.
Suggestions are rounded for readability; no exchange rate entry is needed.
Review the supplier's actual pricing and save separately. These are form
suggestions only: there is no periodic synchronization or saved catalog link.


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
would pass a cap is refused. Budgets count **points**, the team's own measure of
cost: CNY 1 is 1,000 points at the reference rates. With your own provider key,
the provider still bills you directly. Where the server sends email, a budget
can also warn admins or the member as it nears its cap. **Usage** lists every
call by member and model and exports it as CSV.

## 6. Review what members share

Members can submit presets and plugins. Under **Sharing and review**, compare
the proposed contents with what is live, then approve to publish or reject with
a reason.

## 7. Share a DSH with the team

Under **Shared DSHs**, name a DSH the team will run for its members and copy
the command shown once: `/teamwork share enable <key>`. Run it in that DSH. It
then signs in as the team, never as a person, syncs this team alone, and its
team-model calls are the team's. The first machine to use a key keeps it;
**Rotate key** issues a new one for the same machine, and **Delete** cuts it
off. Under **Access**, choose who may reach it: the whole team or listed
members. For each of them, run `/teamwork share invite <email>` in that DSH and
hand the link over yourself; each member then reaches only the sessions they
started. Phone and web clients that open the link come in a later release.

Before it admits anyone, a shared DSH needs your team's **audit key**. On your
own computer, with the plugin's package installed, run
`dsh-teamwork-audit keygen`: it writes `audit-key.json`, which only you keep,
and prints `/teamwork share audit-key <public key>` to run in the shared DSH.
From then on the shared DSH seals everything members do on it to that key and
uploads it, and the server keeps it without being able to read it. Under
**Audit archive** on the same page, download a shared DSH's archive and open it
with `dsh-teamwork-audit read <file> --key audit-key.json`, which also says if
any part is missing or altered. **A lost key cannot be recovered**, and whoever
holds it can read every member's sessions.
