# Discord Navigation Overview

A high-level guide to Discord's UI conventions and navigation patterns. Reference this first when planning any task — it gives the mental model for finding things, even for screens not explicitly documented here.

## What Discord Is
A chat / voice / video platform organized around two main spaces:
- **Servers**: Communities containing channels (text + voice). Selected via the left server sidebar.
- **Direct Messages (DMs)**: Private 1-on-1 or small group chats. Reached via the Home button (Discord logo) at the top of the server sidebar.

## Universal Three-Column Layout
Every major screen uses this structure:

- **Far-left sidebar (~72px wide)** — Server list:
  - Top: Home button (Discord logo) → shows friends/DMs
  - Middle: Vertical list of server icons (circular)
  - Bottom: "Add a Server" (green + icon), "Explore Public Servers" (compass icon)
- **Middle panel (~240px)** — Context-dependent:
  - If Home is selected: DM list + "Find or start a conversation" search
  - If a server is selected: channel list grouped by category; server name at top (clickable for server menu)
  - Bottom of this panel ALWAYS shows the **user panel** (user avatar, username, status, microphone/headset/settings gear icons)
- **Right pane (fills remaining width)** — The actual content: chat view, friends list, settings page, voice channel tiles, etc.

## Icon Language (memorize this)
- **Gear (⚙)** — Settings. User panel gear = user settings. Server header dropdown has "Server Settings".
- **+ (plus)** — Add/create. Add server, create channel, add friend, new DM, attach file.
- **Compass** — Explore / discover public servers
- **# (hash)** — Text channel (preceded by this in channel list)
- **Speaker** — Voice channel
- **@ (at)** — Mention a user / reference
- **Magnifying glass** — Search (scope depends on location: channel, DM, global)
- **Paperclip** — Attach file to a message
- **Emoji face** — Emoji picker
- **Phone / Camera** — Voice call / video call (in DM or voice channel)
- **Pushpin** — Pinned messages in channel header
- **People silhouette** — Toggle member list in channel header
- **Three dots (⋯)** — More actions (hover reveals)
- **Bell** — Notification settings (strike-through = muted)
- **X** — Close modal / dismiss / remove

## How to Reach the Main Sections

| Destination | How to get there |
|---|---|
| Friends list | Home button (top of server sidebar) → "Friends" tab at top |
| Direct Messages | Home button → DM appears in middle panel |
| User Settings | Gear icon at bottom of middle panel (next to username) |
| Server Settings | Click server name at top of channel list → "Server Settings" in dropdown |
| Specific channel | Click the channel in middle panel (# for text, 🔊 for voice) |
| Account/Email settings | User Settings → "My Account" (first item in left sidebar of the overlay) |

## Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl+K` | Quick switcher — jump to any server/channel/DM by typing |
| `Ctrl+,` | Open User Settings |
| `Ctrl+/` | Show all keyboard shortcuts |
| `Ctrl+T` | New DM |
| `Ctrl+Shift+M` | Toggle microphone mute |
| `Ctrl+Shift+D` | Toggle deafen |
| `Escape` | Close any modal, dialog, or overlay |
| `Alt+↑ / Alt+↓` | Next/previous channel |
| `Ctrl+Shift+N` | Create new server |

## Interaction Patterns
- **Right-click on almost anything** (message, user avatar, channel name, server icon) to get a context menu with common actions.
- **Hover to reveal** — message action buttons (react, reply, thread) appear on hover. Three-dots menus expand on hover/click.
- **Modal dialogs** open centered with dark overlay. Close via X button or Escape.
- **Full-screen overlays** (settings) replace the whole app view. Close via X in top-right or Escape.
- **Dropdown menus** usually anchor to the element clicked; first-click opens, click outside or Escape closes.

## User Status Indicators
- **Green solid circle** — Online
- **Yellow crescent** — Idle
- **Red minus circle** — Do Not Disturb
- **Gray hollow circle** — Offline / Invisible
- **Red badge with number** on server icon — unread count in that server
- **Bold channel name** — unread messages in that channel
- **Dot** next to DM — unread messages

## Task Planning Strategy
When given a task, work through these decisions:

1. **Is it account-wide or server-specific?**
   - Account-wide (password, email, notifications, appearance) → User Settings (gear icon)
   - Server-specific (roles, channels, member bans) → Server Settings (server name dropdown)
   - Message-specific → right-click the message
   - Friend-specific → right-click the user

2. **Find the entry point** using the table above.

3. **Navigate with minimal clicks** — use keyboard shortcuts where relevant (`Ctrl+,` for settings is faster than finding the gear).

4. **Verify after each action** — look at the screenshot:
   - Did the expected modal open?
   - Did the setting change reflect in the UI?
   - Are there error toasts (usually red, top of screen)?
   - Is there a confirmation dialog waiting for input?

5. **If stuck**, look for:
   - A `+` icon to create
   - A gear icon to configure
   - Right-click context menu
   - Three-dots (⋯) "more" menu
   - A `?` help icon
   - `Ctrl+K` to search by name

## What This App Is NOT
- Not a file manager — no traditional file tree
- Not a forum (despite "forum channels" feature) — primarily real-time chat
- Not public by default — most content is gated by server membership
