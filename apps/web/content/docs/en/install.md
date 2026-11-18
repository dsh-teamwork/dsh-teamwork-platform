---
title: Install the plugin
description: Add the Teamwork plugin to DSH Desktop or the DSH CLI, sign in, and fix common install problems.
---

The plugin is the npm package `@dsh-teamwork/dsh-teamwork`. Install it into the
DSH profile you actually run, then sign in from its Teamwork panel.

## DSH Desktop

1. Open **Plugins → Add plugin** in the app.
2. Enter the package name, install it and enable it:

   ```text
   @dsh-teamwork/dsh-teamwork
   ```

3. Follow any restart prompt.

Desktop manages its own profile, so install and update it from the app. A CLI
install does not reach Desktop.

## DSH CLI and web

Install into the profile you run (`web` below; use your own profile name if it
differs):

```sh
dsh plugin --profile web add @dsh-teamwork/dsh-teamwork
dsh web
```

For a web process that is already running, follow the host's reload or
restart instructions.

## A Linux server

A DSH can run on a server with no desktop. On Ubuntu or Debian, as
the user DSH will run as:

1. Install Node.js 24 or later:

   ```sh
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. Install DSH. It is published as prereleases for now, so name the exact
   version [npm lists](https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions)
   as `latest`; without one, some npm versions find none:

   ```sh
   npm install -g @deepseek-ai/dsh@0.2.2-rc.1
   ```

3. If `pnpm --version` says 11 or later, first let DSH's profile take a
   release from today and skip dependencies' build scripts it does not need;
   otherwise pnpm 11 installs an older version, or stops with
   `ERR_PNPM_IGNORED_BUILDS`:

   ```sh
   dsh plugin --profile web list
   printf 'minimumReleaseAge: 0\nstrictDepBuilds: false\n' >> ~/.dsh/profiles/web/pnpm-workspace.yaml
   ```

   The first line only makes DSH create the profile, so its own settings are
   written before these two.

4. Install the plugin, then start DSH in a `tmux` session, so it keeps running
   after you log out. Start it in the project folder sessions should work in:
   sessions start there, or in a workspace DSH already has.

   ```sh
   dsh plugin --profile web add @dsh-teamwork/dsh-teamwork
   tmux new -s dsh
   cd /path/to/project
   dsh web --no-open
   ```

   Detach with `Ctrl+B` then `D`; `tmux attach -t dsh` returns to it.

5. In another shell on the same machine, install the plugin's commands,
   `dsh-teamwork` and `dsh-teamwork-audit`. The copy inside DSH's profile is not
   on your `PATH`:

   ```sh
   npm install -g @dsh-teamwork/dsh-teamwork
   ```

6. Then run `dsh-teamwork login`. See
   [Commands](/docs/commands#on-a-server-dsh-teamwork). No browser is needed on
   the server.

The plugin keeps its files in `~/.dsh/dsh-teamwork/` (or `$DSH_HOME/dsh-teamwork/`),
whichever directory DSH is started from.

## Sign in

1. Open **Teamwork** in the DSH sidebar and choose the browser sign-in action.
   From the command input, `/teamwork login` does the same.
2. Sign in on this website and confirm. The browser hands the code back to DSH,
   which finishes signing in by itself.
3. If the hand-back cannot complete, copy the authorization line the page shows
   (`/teamwork authorize <code>`) into DSH. The code works for two minutes.

Signing in syncs the team's resources at once, then every 60 seconds.

### Choose the server

The plugin signs in to `https://www.dshteamwork.com` by default. To use another
server, such as a self-hosted one, change the address on Teamwork's sign-in
screen first. HTTPS is required except on loopback. Changing servers signs you
out and clears the previous server's team resources.

## Update

Update with the same plugin manager you installed with: the app's **Plugins**
page on Desktop. On the CLI, update the profile with `--latest`; without it, a
new minor version such as 0.11 after 0.10 is not picked up. On a server, also
update the commands, then restart DSH:

```sh
dsh plugin --profile web update --latest @dsh-teamwork/dsh-teamwork
npm install -g @dsh-teamwork/dsh-teamwork
```

## If something goes wrong

- **Installed, but missing in Desktop:** a CLI `web` install does not change
  Desktop's profile. Install it from the app.
- **Version rejected:** check the DSH and plugin versions, and install a
  compatible published version from the
  [npm versions page](https://www.npmjs.com/package/@dsh-teamwork/dsh-teamwork?activeTab=versions).
- **A new release is not picked up:** some hosts wait a minimum time after a
  release. Choose an exact version that npm already lists.
- **Still stuck:** run `/teamwork status` in DSH and include its output, with
  tokens and codes removed, in an
  [issue](https://github.com/dsh-teamwork/dsh-teamwork/issues).
