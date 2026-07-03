import { test, expect } from "@playwright/test";
import {
  makeUser,
  signInOrSignUp,
  generateInvite,
  acceptInvite,
  revokeAgentByEmail,
  newUserContext,
  closeContext,
} from "./helpers";

/**
 * End-to-end smoke covering:
 *  1. Owner A invites → Owner B accepts and lands in A's workspace.
 *  2. Owner A revokes B → B's app self-heals back to their own empty workspace.
 *  3. Owner C invites B → B sees "Leave & join new" and switches workspace.
 *
 * Each owner runs in its own browser context so Firebase sessions never collide.
 * Test users are auto-created via the Email/Password sign-up form on /auth and
 * are left in the Firebase project (identifiable by the e2e+*@wabees.test prefix).
 */
test.describe.serial("invite / revoke / switch flows", () => {
  const ownerA = makeUser("ownerA");
  const ownerC = makeUser("ownerC");
  const agentB = makeUser("agentB");
  // Test 3 needs a pristine agent (never revoked/reassigned) so the accept
  // flow doesn't hit stale-workspace edge cases from earlier tests.
  const agentB2 = makeUser("agentB2");

  test("owner A can invite and agent B can accept", async ({ browser }) => {
    const a = await newUserContext(browser);
    const b = await newUserContext(browser);
    try {
      await signInOrSignUp(a.page, ownerA);
      const { code } = await generateInvite(a.page, { role: "agent" });

      await signInOrSignUp(b.page, agentB);
      await acceptInvite(b.page, code);

      // Owner A sees agent B listed.
      await a.page.goto("/agents");
      await expect(a.page.getByText(agentB.email)).toBeVisible({ timeout: 20_000 });
    } finally {
      await closeContext(a.context);
      await closeContext(b.context);
    }
  });

  test("owner A revokes agent B; B loses workspace access", async ({ browser }) => {
    const a = await newUserContext(browser);
    const b = await newUserContext(browser);
    try {
      await signInOrSignUp(a.page, ownerA);
      const { code } = await generateInvite(a.page);

      await signInOrSignUp(b.page, agentB);
      await acceptInvite(b.page, code);

      await revokeAgentByEmail(a.page, agentB.email);

      // B's session should self-heal — inbox becomes empty / gate flips.
      await b.page.reload();
      // Post-revoke B should either see the "you are the owner" empty workspace,
      // a permission error from Firestore, or a workspace-removed banner.
      await expect(
        b.page
          .getByText(
            /you are the owner|missing or insufficient permissions|access (was )?revoked|removed from|no workspace/i,
          )
          .first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await closeContext(a.context);
      await closeContext(b.context);
    }
  });

  test('agent B accepts owner C invite via "Leave & join new"', async ({ browser }) => {
    const a = await newUserContext(browser);
    const c = await newUserContext(browser);
    const b = await newUserContext(browser);
    try {
      // A onboards B first.
      await signInOrSignUp(a.page, ownerA);
      const inviteA = await generateInvite(a.page);

      await signInOrSignUp(b.page, agentB2);
      await acceptInvite(b.page, inviteA.code);

      // C creates a competing invite.
      await signInOrSignUp(c.page, ownerC);
      const inviteC = await generateInvite(c.page);

      // B accepts C's invite → switch prompt appears, confirm to leave A.
      await acceptInvite(b.page, inviteC.code, { expectSwitchPrompt: true });

      // C's agents page shows B.
      await c.page.goto("/agents");
      await expect(c.page.getByText(agentB2.email)).toBeVisible({ timeout: 20_000 });

      // A's agents page should show B as left/revoked.
      await a.page.goto("/agents");
      const row = a.page.locator("li, tr, [data-agent-row]").filter({ hasText: agentB2.email }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row.getByText(/left|revoked|inactive/i).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await closeContext(a.context);
      await closeContext(b.context);
      await closeContext(c.context);
    }
  });
});