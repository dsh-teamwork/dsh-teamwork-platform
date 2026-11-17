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
page on Desktop, or `dsh plugin` on the CLI.

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
