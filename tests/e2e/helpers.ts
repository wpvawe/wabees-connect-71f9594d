import { expect, type BrowserContext, type Page } from "@playwright/test";

export type TestUser = {
  email: string;
  password: string;
  displayName: string;
};

/** Create a unique test user identity (does not create the Firebase account). */
export function makeUser(label: string): TestUser {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return {
    email: `e2e+${label}-${stamp}@wabees.test`,
    password: `E2ePass!${stamp}`,
    displayName: `E2E ${label} ${stamp.slice(-4)}`,
  };
}

/** Sign up a fresh Firebase user through the /auth UI. Ends at /dashboard (or /join if pending). */
export async function signUp(page: Page, user: TestUser) {
  await page.goto("/auth");
  // Toggle to "Create account" tab.
  await page.getByRole("button", { name: /create account/i }).first().click();
  await page.getByLabel(/your name/i).fill(user.displayName);
  await page.getByLabel(/work email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /^create account$/i }).click();
  // Wait for either a toast + navigation, or an auth error.
  await page.waitForURL(/\/(dashboard|inbox|join)\b/, { timeout: 30_000 });
}

/** Sign in an existing user through /auth. */
export async function signIn(page: Page, user: TestUser) {
  await page.goto("/auth");
  await page.getByLabel(/^email$/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/(dashboard|inbox|join|agents)\b/, { timeout: 30_000 });
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
  await page.goto(`/join/${code}`);
  const acceptBtn = page.getByRole("button", { name: /accept invite/i });
  const switchBtn = page.getByRole("button", { name: /leave.*join new/i });

  if (opts.expectSwitchPrompt) {
    // First-time click surfaces the prompt.
    await acceptBtn.click();
    await expect(switchBtn).toBeVisible({ timeout: 15_000 });
    await switchBtn.click();
  } else {
    await acceptBtn.click();
  }
  // Success screen navigates to /inbox after ~1.2s.
  await page.waitForURL(/\/inbox\b/, { timeout: 30_000 });
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