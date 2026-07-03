# E2E smoke tests

Playwright specs covering the owner/agent invite lifecycle.

## Run

```bash
bun run test:e2e                 # against the preview URL
E2E_BASE_URL=http://localhost:8080 bun run test:e2e
bun run test:e2e:headed          # watch it click
bun run test:e2e:ui              # Playwright UI mode
```

First run only:

```bash
bunx playwright install chromium
```

## What it covers

`invite-flows.spec.ts` (serial):

1. **Invite + accept** — Owner A generates an invite, Agent B accepts, A sees B listed.
2. **Revoke** — A revokes B, B's app self-heals out of A's workspace.
3. **Switch workspace** — Owner C invites B, B sees the "Leave & join new"
   prompt and switches; C sees B, A shows B as left/revoked.

## Test users

Each run auto-creates fresh Firebase Email/Password accounts using the prefix
`e2e+<label>-<stamp>@wabees.test`. They stay in the `wabees-app` Firebase project
after the run — purge periodically from Firebase Auth if the list grows.

Requires Email/Password sign-up to be enabled on the Firebase project (it is).

## Target URL

Defaults to the current preview URL from `playwright.config.ts`.
Override any time with `E2E_BASE_URL=<url> bun run test:e2e`.