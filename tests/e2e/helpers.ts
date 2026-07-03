import { expect, type BrowserContext, type Page } from "@playwright/test";

export type TestUser = {
  email: string;
  password: string;
  displayName: string;
};

/**
 * Stable test-user pool. Same email + password on every run — no new Firebase
 * accounts get created after the first run (which the platform owner approves
 * once). Do NOT change the email/password without coordinating with the owner
 * who has to re-approve.
 */
const FIXED_PASSWORD = "E2ePass!Wabees2026";
export function makeUser(label: string): TestUser {
  const slug = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  return {
    email: `e2e-${slug}@wabees.test`,
    password: FIXED_PASSWORD,
    displayName: `E2E ${label}`,
  };
}

/** Sign up a fresh Firebase user through the /auth UI. Ends at /dashboard (or /join if pending). */
export async function signUp(page: Page, user: TestUser) {
  await page.goto("/auth");
  // Toggle to the "Create account" tab (first "Create account" is the tab button).
  await page.getByRole("button", { name: /^create account$/i }).first().click();
  const form = page.locator("form").filter({ hasText: /create account/i }).first();
  await form.getByLabel(/your name/i).fill(user.displayName);
  await form.getByLabel(/work email/i).fill(user.email);
  await form.getByLabel(/password/i).fill(user.password);
  await form.getByRole("button", { name: /^create account$/i }).click();
  // Sign-up succeeded — now wait past the "Waiting for approval" gate.
  await waitForApproval(page, user);
}

/**
 * Poll the "Waiting for approval" gate until the platform owner approves
 * the account (manual step). Clicks "Check again" every 5s for up to 10 min.
 */
export async function waitForApproval(page: Page, user: TestUser) {
  const deadline = Date.now() + 10 * 60_000;
  // If we're already past the gate, bail early.
  const gate = page.getByRole("heading", { name: /waiting for approval/i });
  try {
    await gate.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`\n  → Awaiting manual approval for: ${user.email}\n`);
  while (Date.now() < deadline) {
    if (!(await gate.isVisible().catch(() => false))) return;
    const checkAgain = page.getByRole("button", { name: /check again/i });
    if (await checkAgain.isVisible().catch(() => false)) {
      await checkAgain.click().catch(() => {});
    }
    await page.waitForTimeout(5_000);
    // Any redirect off /auth means approval landed.
    if (!/\/auth\b/.test(page.url())) return;
  }
  throw new Error(`Timed out waiting for approval of ${user.email}`);
}

/** Sign in an existing user through /auth. */
export async function signIn(page: Page, user: TestUser) {
  await page.goto("/auth");
  const form = page.locator("form").filter({ hasNot: page.getByLabel(/your name/i) }).first();
  await form.getByLabel(/^email$/i).fill(user.email);
  await form.getByLabel(/password/i).fill(user.password);
  await form.getByRole("button", { name: /^sign in$/i }).click();
  await waitForApproval(page, user);
}

/** Sign in if the account exists, otherwise sign up. Handles the approval gate. */
export async function signInOrSignUp(page: Page, user: TestUser) {
  await page.goto("/auth");
  // The Sign-in form is the one WITHOUT the "Your name" field.
  const form = page.locator("form").filter({ hasNot: page.getByLabel(/your name/i) }).first();
  await form.getByLabel(/^email$/i).fill(user.email);
  await form.getByLabel(/password/i).fill(user.password);
  await form.getByRole("button", { name: /^sign in$/i }).click();
  // Race: either we navigate away / gate appears, or a toast says invalid creds.
  const gate = page.getByRole("heading", { name: /waiting for approval/i });
  const invalid = page.getByText(/invalid email or password|user-not-found|wrong-password/i);
  const raced = await Promise.race([
    page
      .waitForURL((u) => !/\/auth\/?$/.test(new URL(u).pathname), { timeout: 8_000 })
      .then(() => "in" as const)
      .catch(() => null),
    gate
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => "gate" as const)
      .catch(() => null),
    invalid
      .first()
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => "missing" as const)
      .catch(() => null),
  ]);
  if (raced === "missing" || raced === null) {
    await signUp(page, user);
    return;
  }
  await waitForApproval(page, user);
}

/** As an owner already signed in, generate an agent invite and return its code + link. */
export async function generateInvite(
  page: Page,
  opts: { role?: "agent" | "supervisor"; lockedEmail?: string } = {},
): Promise<{ code: string; link: string }> {
  await page.goto("/agents");
  await page.getByRole("button", { name: /invite/i }).first().click();

  // Role toggle (defaults to "agent").
  if (opts.role === "supervisor") {
    await page.getByRole("button", { name: /^supervisor$/i }).click();
  }
  if (opts.lockedEmail) {
    await page.getByLabel(/email \(optional\)/i).fill(opts.lockedEmail);
  }
  await page.getByRole("button", { name: /generate invite/i }).click();

  // Wait for the readonly link input to appear.
  const linkInput = page.locator('input[readonly][value^="http"]');
  await expect(linkInput).toBeVisible({ timeout: 15_000 });
  const link = (await linkInput.inputValue()).trim();
  const code = link.split("/join/")[1] ?? "";
  expect(code).not.toBe("");
  // Close the dialog.
  await page.keyboard.press("Escape");
  return { code, link };
}

/** Accept an invite as the signed-in user. If a "Leave & join new" prompt appears, confirm. */
export async function acceptInvite(
  page: Page,
  code: string,
  opts: { expectSwitchPrompt?: boolean } = {},
) {
  // Surface any client-side errors during the accept flow.
  page.on("console", (m) => {
    if (m.type() === "error") {
      // eslint-disable-next-line no-console
      console.log(`  [console.error] ${m.text()}`);
    }
  });
  await page.goto(`/join/${code}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const acceptBtn = page.getByRole("button", { name: /accept invite/i });
  await acceptBtn.waitFor({ state: "visible", timeout: 20_000 });
  // Give Firebase auth + invite-lookup effects one extra tick.
  await page.waitForTimeout(500);
  const switchBtn = page.getByRole("button", { name: /leave.*join new/i });

  if (opts.expectSwitchPrompt) {
    // First-time click surfaces the prompt.
    await acceptBtn.click();
    await expect(switchBtn).toBeVisible({ timeout: 15_000 });
    await switchBtn.click();
  } else {
    await acceptBtn.click();
    // If the app decides a switch-prompt is required (e.g. because the user
    // is already an agent of another workspace from a previous run), auto-
    // confirm it. Keeps the test idempotent across re-runs.
    if (await switchBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await switchBtn.click();
    }
  }
  // Success screen navigates to /inbox after ~1.2s. If it doesn't,
  // any URL off /join also counts (the app may drop us on /dashboard
  // in some race conditions).
  await page.waitForURL((u) => !/\/join\//.test(new URL(u).pathname), {
    timeout: 45_000,
  });
}

/** As an owner, revoke the first non-owner agent row by email match. */
export async function revokeAgentByEmail(page: Page, email: string) {
  await page.goto("/agents");
  const row = page.locator("li, tr, [data-agent-row]").filter({ hasText: email }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  // Handle native confirm() from the Revoke button.
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: /revoke/i }).first().click();
  await expect(row.getByText(/revoked|inactive/i).first()).toBeVisible({ timeout: 15_000 });
}

/**
 * As an owner, remove any leftover agent rows (revoked / left) for the given
 * emails so the next accept flow starts clean. Idempotent — no-ops if the
 * rows aren't there.
 */
export async function purgeAgentRows(page: Page, emails: string[]) {
  await page.goto("/agents");
  await page.waitForLoadState("networkidle").catch(() => {});
  for (const email of emails) {
    // Loop until no row for this email remains (there may be revoked + left).
    for (let i = 0; i < 5; i++) {
      const row = page
        .locator("li, tr, [data-agent-row]")
        .filter({ hasText: email })
        .first();
      if (!(await row.isVisible({ timeout: 1_500 }).catch(() => false))) break;
      page.once("dialog", (d) => d.accept());
      // Trash icon button (aria-label may be "Delete" / "Remove") — fall back to last button in row.
      const del = row.getByRole("button").last();
      await del.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
}

/** Fresh browser context per test user (so sessions don't collide). */
export async function newUserContext(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
  const page = await context.newPage();
  return { context, page };
}

/** Best-effort cleanup — close and dispose. */
export async function closeContext(context: BrowserContext) {
  try {
    await context.close();
  } catch {
    /* ignore */
  }
}