---
title: Set up a team
description: Create a team, connect a provider, publish models and presets, bring members in and set budgets.
---

A team is ready when it has a model members can call, a preset to start from,
and its members. Every new team starts with the **Team assistant** preset, and
on the hosted service with its platform models too. As the team's admin you land
on its **Team overview**. Until your own DSH is connected it opens with that:
sign in to Teamwork from DSH on your computer, then pair a browser (**My DSH**)
or the phone app with it. Below that it tracks what the team still lacks, and
once the team is running opens with what waits on you:
budgets near their limit, calls to resolve and budget
mail that failed. It heads **Team management** at the foot of the sidebar,
which only the team's admin sees, with **Models** and **Members and spend** (members, usage and
budgets) below it. Presets and plugins are managed in the Workspace's **Presets
and plugins**, where you see the same list as members with your own actions
added. Team management starts folded: open it with its toggle or
**Alt+M** (**Option+M** on a Mac), and it folds away again when you choose a
Workspace page. Press **Esc** to fold Team management. If a dialog is open,
**Esc** closes the dialog first. The **Workspace** pages at the top are the same for
you as for every member: your own **Home** shows your own calls and budget.

## 1. Create the team

Sign in to the console and choose **Create team** on the teams page. You
become its admin. Every new team gets a **team assistant** preset.

## 2. Connect a provider and publish models

Open **Models → BYOK model service**. Pick a provider from the list and paste its API
key (each listed provider is named as [Models.dev](https://models.dev) names it,
such as `alibaba-cn` or `moonshotai-cn`, which is where its models' limits and
prices are read), or enter any OpenAI-compatible address under **Custom**. Kimi and
MiniMax offer several accounts: choose the **Region** (mainland China or
international) and the **Billing** (pay as you go, or the Kimi Coding Plan or
MiniMax Token Plan subscription) your key belongs to, and the address and name
follow. Each is its own catalog entry with its own model IDs and prices; a
subscription's models are imported at a price of 0, so calls to them use no
member's budget, and its key is the one issued for the subscription. The key is checked
with the provider before it is saved: a key the provider refuses, or an address
this server may not call, is shown on the form with what to change. The key is
stored encrypted and can never be read back. Then tick the models the team
should use. As you tick one, its public reference is looked up and shown beside
it; publishing gives each model the context window the provider or that
reference states, and its reference rate, converted from the public prices as
**Fill reference prices** does below. A model priced this way can be called at
once. A model with no exact, agreeing reference is published without a rate
and cannot be called until you give it one (its **Set rates** button, which
opens filled from the reference when there is one); the models page and the
team overview list it until it has one, and **Fill from reference prices** on
the models page retries every such model at once. A rate of zero is allowed.
A rate belongs to the upstream model it was set for, so pointing a model at
another one needs a new rate.

Each provider and model is shown with its maker's logo, here and wherever the
console or the phone app names a model.

Members see team models only: never the address or the key.

When typing a model ID by hand, or editing a model, **Fill from public catalog** fills the
context window, maximum output and image understanding at once from the entry
whose ID is exactly the model's: OpenRouter for OpenRouter, Models.dev for
every other provider, under the listed provider's entry, found by its name or
else its address (for a provider that matches no listed entry, such as your own
proxy, it looks up only the exact ID across all of Models.dev's providers, and
says so when nothing is found). A note under the button
says where the values came from and what changed, with **Undo**. Unknown values
leave your entries alone. When there is no exact match, or several providers
list the same ID, nothing changes and **Choose a reference…** lets you pick one
by another name. The call ID never changes, and nothing is published until you
save.

For an exact provider and model match, the catalog can also fill the supported
reasoning efforts. Review or edit the choices before publishing. Members see
those efforts in the DSH, App and Web model pickers after the plugin syncs. With
no efforts selected, the model uses the provider's default behavior.

In a model's reference-rate dialog, while the rate is an estimated cost rather
than an internal weight, **Fill reference prices** does the same with the
public prices, converted to CNY per million text tokens at the latest reference
exchange rate and rounded up; the note shows the rate and its date. Review the
supplier's actual pricing, then save. These only fill the form: nothing is
synchronized later and no catalog link is saved.


To manage picture input, edit a BYOK model and set **Image understanding**.
**Fill from public catalogue** looks up the current model.


## 3. Add presets and plugins

Both live in **Presets and plugins**. What you add there is the team's own and
on every member's DSH, unless a member removes it.

- **Presets** are roles the team shares: the model a preset calls, the tools it
  needs and the way it works. Start from a template (writer, data analyst,
  research analyst or presentation master) or a blank preset, and give it an
  avatar, which members see beside it in the console and the phone app. The
  presentation master plans a talk, writes the slides and their speaker notes,
  and publishes the deck as an artifact that presents full screen and exports to PDF
  and an editable PowerPoint file. The research analyst reads primary sources
  and publishes a report with numbered citations, gaps and dated sources, which
  prints to PDF and saves as Markdown. For web search a member chooses
  **Teamwork** under Web search and fetch in DSH, where the server offers it
  (the hosted service does), or adds a DeepSeek API key; without either it
  works from the pages it can open.
- **Plugins** pin npm packages at exact versions, so everyone runs the same
  build: on the Plugins tab, choose **Add from npm**. Members still confirm each
  installation in their own DSH.

Every change is published to members at their next sync and kept as a version
under **Version history**, linked from the top of Presets and plugins.

## 4. Bring people in

Open **Members**. Depending on how the server signs people in:

- **With email sign-in**, create an invitation link. It works once, for 24 hours.
- **With passwords**, enter the person's email to create their account. Copy
  the first password shown and give it to them; it is not shown again. They sign
  in with it once and choose their own.

Send new members the [install guide](/docs/install).

A team has one admin. To hand the role to someone else, choose **Make admin**
beside them; you become a member.

To delete the team, choose **Delete team** at the foot of **Members** and type
the team's name. Everyone in it loses it at once, and its models, presets,
plugins, versions, usage and budgets are deleted with it. This cannot be undone.

## 5. Set budgets

Every model has its reference rate from step 2. Under **Budgets**,
add daily or monthly caps for the whole team, a default for each member, or a
provider. A call reserves its largest possible cost before it runs, and one that
would pass a cap is refused. Only models whose largest cost the server can work
out run under an enabled budget: today the official DeepSeek API and the
service's hosted models. Calls to any other provider of your own are refused
while a budget is on. Budgets count **points**, the team's own measure of
cost: CNY 1 is 1,000 points at the reference rates. With your own provider key,
the provider still bills you directly. Where the server sends email, a budget
can also warn admins or the member as it nears its cap. **Usage** opens on the
period at a glance: the team budget used and left, the totals, each day's points,
and who and which models spent them, each member against their own limit. Below it
lists every call by member and model and exports it as CSV.

## 6. Recommend what members share

Open a member's preset or plugin in **Presets and plugins** and choose
**Recommend to the team**: that version reaches every member's DSH at their
next sync, under the name you give it if you give one. When its author
publishes a newer version, the row says the recommendation is behind and the
**Recommendation behind** filter collects them; read the change, then choose
**Recommend v…** to move it. **Stop recommending** leaves it with whoever added
it; **Withdraw** takes it out of the list for everyone, though whoever uses it
keeps it.

## 7. Share what the team knows

Under **Knowledge**, choose **New space** (in the sidebar beneath Knowledge, or on its overview) for each body of knowledge: a
glossary, the product's rules, the runbooks. A new space is read by the whole
team. Its menu adds folders and documents, and **Space settings** renames it,
narrows reading to chosen members, names the members who edit it besides you,
chooses the folder whose documents are its templates, or deletes it with
everything in it. Every member's agent reads the spaces its
member may read and proposes changes; a space's editors decide them under
**Proposals**.
