# Native Web sessions and shell

> **Status:** Plan — sessions and shell built · **Updated:** 2026-11-22

How native DSH Web (`relay.md`, "Native Web on a personal computer") gains the
sessions, the shell and the computer-side control of
[ADR 0065](../adr/0065-native-web-sessions-and-shell.md): what each part does,
the order of work, what gates it, and how done is verified. When it ships,
`relay.md` describes what was built and this plan is deleted.

## Goal

- Access through a ticket ends after thirty minutes with no traffic, or after
  eight hours in any case.
- It is refused from a client other than the one that entered.
- DSH shows inside a thin Teamwork bar on the computer's own origin: which
  computer, whether it is connected, the traffic, the way back to Teamwork,
  and ending the session.
- The computer shows that its native Web is in use, and ends every session
  with one command.

## Non-goals

- A bar or frame served from `dshteamwork.com`. ADR 0065 says why.
- Binding a session to the client's address.
- Confirming each entry on the computer.
- Changing the tunnel itself: one data socket per upstream connection stays.
- Installing native Web as an app. Its manifest still answers 404.

## Sessions (`server/relay/web.go`)

- **Table.** Each computer's `desktopWebHost` gains a session table, kept in
  memory and cleared with the host when its control connection ends. Each
  session records:
  - id (16 random bytes);
  - User-Agent hash;
  - locale;
  - where the ticket came from: `app` for a Bearer (the phone app), `web` for
    a console session;
  - entered at;
  - last activity;
  - bytes up and down;
  - its open requests' cancel functions.

  At most sixteen sessions per computer; a seventeenth evicts the one longest
  idle and cancels its requests.
- **Cookie.** The cookie stays `__Host-dsh-desktop`, sealed under the
  process's key with the label and the host generation as additional data. It
  holds the session id alone; the table holds the rest. The browser keeps it
  for eight hours.
- **Refusal.** A request is refused, its session dropped and its requests
  cancelled, when any of these holds:
  - the session is not in the table;
  - its User-Agent hash differs;
  - thirty minutes have passed since its last activity;
  - eight hours have passed since entry.

  A request without a cookie, or with one that does not open, gets the closed
  page with a link to My DSH.
- **Activity.** Every proxied request marks the session active. Bytes through
  its tunnels do too, an open WebSocket's included, and so does every byte
  counted for the bar. `/__dsh/status` does not, so a shell left open with DSH
  gone quiet still lapses.
- **Idle sweep.** A sweep every minute ends idle sessions and closes their
  WebSockets. The idle and absolute limits are package variables a test can
  shorten.

## The shell

- **Paths.** The gateway owns everything under `/__dsh/` on a computer's
  origin and never proxies it:

  | Path | What it does |
  | --- | --- |
  | `GET /__dsh/enter?ticket=…` | Spends the ticket and creates the session. Sets the cookie and answers a same-origin refresh to `/__dsh/` (replaces `/__dsh_desktop_enter`). |
  | `GET /__dsh/` | The shell: the bar, and a frame of `/` or of `?path=`. The path must start with one `/`. |
  | `GET /__dsh/status` | JSON: computer name, connected, the session's bytes up and down so far (the bar turns them into a rate), the last tunnel's dial time, session end. |
  | `POST /__dsh/end` | Ends this session (exact Origin required), then shows the closed page. |

- **Navigation.** A request with `Sec-Fetch-Dest: document` outside `/__dsh/`
  is answered 303 to `/__dsh/?path=<that path and query>`, so a DSH link that
  opens a window, or an address typed by hand, lands in a shell. A frame's
  requests (`iframe`) and subresources pass as now.
- **Headers.** Proxied responses carry `frame-ancestors 'self'` in place of
  `'none'`. The shell's own pages carry `frame-ancestors 'none'` and a CSP with
  no inline script, its script and style served from `/__dsh/`.
- **The frame.** `allow="clipboard-read; clipboard-write; fullscreen"`, no
  sandbox: it is the same origin and the owner's own DSH.
- **The bar.** One line, about 32 px:
  - the computer's name and a status dot (connected, reconnecting, gone);
  - traffic up and down per second (no session totals);
  - the last dial time;
  - "Back to Teamwork": `dshteamwork://` for a session the phone app opened,
    which returns to the app (the in-app browser cannot be closed from the
    page), else the console page the ticket request named (`returnTo`, only
    `/teams/{teamId}/my-dsh[/{hostId}]` admitted), else `APP_URL`'s home;
  - "End session".

  On a narrow screen the traffic folds into the dot's tooltip. The bar polls
  `/__dsh/status` every two seconds, and stops and shows "Session ended" once
  it answers 404.
- **Words.** `server/relay/messages/en.json` and `zh-CN.json` hold the words,
  the Go-embedded locale files `lint:lang` already admits. The locale is the
  console's at ticket time (profile, then `locale` cookie, then
  `Accept-Language`), kept on the session.

## The computer (`../dsh-teamwork`)

- **Showing use.** The plugin counts the tunnels it serves and when one last
  moved. `PanelState.nativeWeb` gains `active: { tunnels, lastActivity }`. The
  panel shows "In use" with the time, and `dsh-teamwork status` adds it to its
  `Native Web` line.
- **Ending every session.** The panel button "Disconnect all" and
  `dsh-teamwork web disconnect` send a new relay frame, `{"t":"webRevoke"}`.
  The gateway answers it by doing all of these:
  - draws a new generation for the host, so every cookie stops opening;
  - drops the session table;
  - cancels every open request;
  - closes the tunnels.

  The control connection, and with it the paired phones, stays up. The plugin
  closes its own side of every tunnel too.
- **Wire.** `server/relay/protocol.go` and `src/relay.ts` gain the frame. The
  platform must be deployed before a plugin that sends it is released.

## Order of work

1. **Sessions.** Table, cookie claims, idle and absolute limits, User-Agent
   check, eviction. Relay unit tests with shortened limits.
2. **Shell.** Paths, navigation redirect, headers, status and end, the bar,
   words. Gated on 1. Rendered in Chromium at both locales and at phone width
   before it lands.
3. **`webRevoke` on the gateway.** Deployed before 4.
4. **The plugin.** Showing use, "Disconnect all",
   `dsh-teamwork web disconnect`. Released as a 0.19 patch after 3 is live.
5. **Docs.** `relay.md` rewritten to describe the result, this plan deleted,
   the changelog, the plugin's guide in both languages.

The platform part (1–3) goes into premium by an upstream merge and deploys
from `main`, as before.

## Verification

- **Relay unit tests:**
  - idle expiry and the absolute limit, with shortened limits;
  - a User-Agent change refused;
  - the seventeenth session evicting the longest idle;
  - `/__dsh/status` not counting as activity;
  - a top-level navigation redirected into the shell, a frame request passing;
  - `POST /__dsh/end` without its Origin refused;
  - `webRevoke` ending every session while the control connection stays.
- **`TestPluginNativeWeb`:** enters through `/__dsh/enter`, loads the shell,
  and reaches DSH through the frame's requests. It checks idle expiry with a
  shortened limit, and that `dsh-teamwork web disconnect` ends the browser's
  access.
- **A Chromium check** of the shell against a local server, at `en` and
  `zh-CN`, desktop and phone width: the bar's layout, DSH in the frame, a DSH
  link opening a new shell, "End session".
- **On real devices, by the owner:** web and the phone app's in-app browser.
  Live data, an upload, leaving a tab idle past thirty minutes, "Disconnect
  all" from the computer.

## Open questions

None. The owner settled the two that were open: "Back to Teamwork" returns
to the phone app when the app opened the session, and the bar shows traffic
per second only.
