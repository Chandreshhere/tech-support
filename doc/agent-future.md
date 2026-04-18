# Agent Future Work — Human-in-the-Loop Enhancements

Deferred features for richer human-agent interaction. Current implementation uses the simpler "pause + continue" model (see [agent/prompts.js](../agent/prompts.js)). These are ideas to revisit once the simple version is battle-tested.

---

## 1. `ask_user` with Typed Answers

Today's pause is binary: "do it yourself, then click Continue." But some situations are better solved by having the user *tell* the agent something rather than doing it manually:

- Ambiguous choice: "I see two accounts on this login screen — 'work@example.com' and 'personal@example.com'. Which should I pick?"
- OTP code: user reads it from email and types it into the chat, agent types it into the OTP field (saves the window switch)
- Clarifying question mid-task: "The task was 'change email' — change it to what?"

### Design sketch
- New action variant: `ask_user_typed` with `{ question, placeholder, expectedFormat?: 'text'|'number'|'email'|'code' }`
- Frontend: pause card shows the question + an input field + Submit button
- On submit: backend appends user's answer as a `HumanMessage` in the agent's conversation → resumes loop
- Agent uses the answer (e.g. types the OTP into the field, or clicks the matching account)

### Security note
Never accept passwords this way. Passwords go directly from user to OS, not through the agent's conversation.

---

## 2. Password Manager Integration

Instead of pausing on password fields, trigger the user's password manager via its keyboard shortcut. This keeps the agent flowing without it ever seeing credentials.

### Design sketch
- Per-context config field: `passwordManagerShortcut` (e.g. `ctrl+shift+l` for Bitwarden, `ctrl+backslash` for 1Password)
- System prompt knows the shortcut via context config
- When agent detects password field: `press_keys` the shortcut → password manager popup → user selects entry → auto-fills
- Only pauses if autofill fails or no shortcut configured

### Caveats
- Requires the user to have a password manager configured for the target app
- Password manager popups may need user click — so it's semi-automatic not fully

---

## 3. Pre-Configured Per-Context Credentials

For non-human workflows (CI, automation scripts), allow storing encrypted credentials scoped to a context.

### Design sketch
- SQLite table `context_credentials(context_id, key_name, encrypted_value)`
- Encrypted at rest with a user-supplied passphrase (entered on backend start, kept in memory)
- Agent can reference via template: `type_text: "$USERNAME"` → backend substitutes from credentials
- UI: "Credentials" tab in Context Settings with add/edit/delete

### Caveats
- This is fundamentally less secure than user-typed passwords
- Should be opt-in per context, with prominent warnings
- Never applicable to 2FA/OTP (by definition they shouldn't be storable)

---

## 4. Agent Run Persistence

Currently each agent run is ephemeral — backend crashes, run is lost. For long-running tasks (multi-hour workflows, tasks with many pauses), persisting run state lets the user:
- Resume after a backend restart
- Review past runs (audit log)
- Fork a failed run from a specific step

### Design sketch
- SQLite table `agent_runs(id, context_id, task, status, created_at, updated_at)`
- SQLite table `agent_run_events(run_id, step, role, content, timestamp)`
- On each step, persist the action + result
- On resume: load events, reconstruct conversation, take fresh screenshot, continue

---

## 5. Destructive-Action Approval Gates

Ask for explicit confirmation before actions that delete data, send messages, or make purchases.

### Design sketch
- System prompt instructs: "Before any destructive action (delete, send, submit payment), use `confirm_action` with a short description."
- New action `confirm_action: { description, action }` — agent emits this instead of the actual action
- Frontend shows yellow warning card: "Agent wants to: Delete server 'Test Discord'. Allow? [ Yes, continue ]  [ No, stop task ]"
- Agent proceeds only after user approval

### Configurable strictness
- Per-context: `approvalMode: 'strict' | 'moderate' | 'off'`
- Strict: approval on every click
- Moderate: approval on destructive actions only (detected via prompt)
- Off: fire-and-forget

---

## 6. Batch Plan Approval (Upfront Review)

Before running a multi-step task, agent drafts a plan and user reviews.

### Design sketch
- Two-phase: plan → execute
- Phase 1: agent outputs `propose_plan: [{step, description, risk}]` without actually clicking anything
- Frontend shows the plan as a checklist
- User checks/unchecks steps, clicks Approve
- Phase 2: agent executes only the approved steps, pausing if state diverges from the plan

### Use case
Particularly useful for destructive sequences ("migrate these 50 channels to a new server"). User sees the full plan before any irreversible action.

---

## 7. Action Allowlist per Context

Restrict the set of actions available to the agent in a given context (defense in depth).

### Design sketch
- Per-context config: `allowedActions: ['click', 'type', 'press_keys', 'screenshot']`
- Explicitly excludes dangerous actions (e.g. no `run_command` via MCP)
- Backend enforces at the agent boundary; LLM can't bypass via prompt injection

---

## 8. Screen-Recording the Session

For audit + debugging, optionally record the screen during agent runs.

### Design sketch
- Per-context toggle: "Record sessions"
- On run start: spawn ffmpeg → captures screen to `contexts/<id>/recordings/<runId>.mp4`
- On run end: saves the recording, links it to the run event log
- Useful for:
  - Debugging unexpected behavior post-hoc
  - Demonstrating what the agent did for compliance
  - Training: "this is how to do task X" recordings become task templates

---

## Priority / Sequencing

The simple `pause` + `continue` is in production. Next likely additions in order:

1. **Typed ask_user** (#1) — handles most ambiguity cheaply
2. **Destructive-action approval gates** (#5) — safety
3. **Agent run persistence** (#4) — debugging + reliability
4. **Password manager integration** (#2) — UX polish for logins
5. **Batch plan approval** (#6) — power-user feature for complex workflows

Items #3 (stored credentials) and #7 (action allowlist) are situational.

---

## Notes

- All of these compose — they're not mutually exclusive
- The current `pause` action can be extended in-place into `ask_user_typed` (add a params field) without breaking existing behavior
- Keep each addition opt-in per context so users aren't forced into complexity they don't need
