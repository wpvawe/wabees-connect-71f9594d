import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCircleNotch,
  faCircleCheck,
  faTriangleExclamation,
  faUserPlus,
  faUserShield,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { onAuthStateChanged, type User } from "firebase/auth";
import { fbAuth } from "@/integrations/firebase/client";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { WbButton } from "@/components/wb/WbButton";
import {
  acceptAgentInvite,
  lookupInviteByCode,
  PENDING_INVITE_KEY,
  type GlobalInvite,
} from "@/lib/firebase/agent-invites";
import { toast } from "sonner";

export const Route = createFileRoute("/join/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Join a workspace — Wabees" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null | "loading">("loading");
  const [invite, setInvite] = useState<GlobalInvite | null | "loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth(), (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const inv = await lookupInviteByCode(code);
        if (!alive) return;
        if (!inv) {
          setInvite("error");
          setErrorMsg("Invite code not found. Please check the link with the person who invited you.");
          return;
        }
        setInvite(inv);
      } catch (e) {
        if (!alive) return;
        setInvite("error");
        setErrorMsg(e instanceof Error ? e.message : "Could not load invite.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);

  function goSignIn() {
    try {
      window.sessionStorage.setItem(PENDING_INVITE_KEY, code);
    } catch {
      /* ignore */
    }
    navigate({ to: "/auth" });
  }

  async function accept() {
    if (!user || user === "loading" || invite === "loading" || invite === "error" || !invite) return;
    setAccepting(true);
    try {
      await acceptAgentInvite({
        code: invite.code,
        selfUid: user.uid,
        selfEmail: user.email ?? null,
      });
      try {
        window.sessionStorage.removeItem(PENDING_INVITE_KEY);
      } catch {
        /* ignore */
      }
      setAccepted(true);
      toast.success("You've joined the workspace");
      setTimeout(() => {
        navigate({ to: "/inbox" });
      }, 1200);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept invite");
    } finally {
      setAccepting(false);
    }
  }

  const loading = user === "loading" || invite === "loading";
  const inv = typeof invite === "object" && invite !== null ? invite : null;

  return (
    <AuthLayout title="Join a workspace" subtitle="Wabees team invite">
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <FontAwesomeIcon icon={faCircleNotch} className="mr-2 h-4 w-4 animate-spin" />
          Loading invite…
        </div>
      ) : invite === "error" || !inv ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <FontAwesomeIcon icon={faTriangleExclamation} className="mt-0.5 h-4 w-4" />
            <div>{errorMsg ?? "This invite is not valid."}</div>
          </div>
          <WbButton variant="secondary" onClick={() => navigate({ to: "/" })}>
            Back to home
          </WbButton>
        </div>
      ) : accepted ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <FontAwesomeIcon icon={faCircleCheck} className="h-8 w-8 text-emerald-500" />
          <p className="text-sm text-foreground">
            You&apos;ve joined {inv.ownerBusinessName || inv.ownerEmail || "the workspace"}.
          </p>
          <p className="text-xs text-muted-foreground">Taking you to the inbox…</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <FontAwesomeIcon icon={faUserPlus} className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                You&apos;re invited
              </span>
            </div>
            <p className="text-foreground">
              Join{" "}
              <strong>{inv.ownerBusinessName || inv.ownerEmail || "this workspace"}</strong> as a{" "}
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase text-primary">
                <FontAwesomeIcon
                  icon={inv.role === "supervisor" ? faUserShield : faUser}
                  className="h-2.5 w-2.5"
                />
                {inv.role}
              </span>
            </p>
            {inv.email && (
              <p className="mt-2 text-xs text-muted-foreground">
                This invite is locked to <strong>{inv.email}</strong>.
              </p>
            )}
            {inv.expiresAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Expires {new Date(inv.expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {user ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Signed in as <strong>{user.email ?? user.uid}</strong>
              </p>
              <WbButton onClick={accept} loading={accepting} className="w-full">
                Accept invite &amp; join
              </WbButton>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Sign in or create an account to accept this invite. Any email works unless the
                invite is locked to a specific address.
              </p>
              <WbButton onClick={goSignIn} className="w-full">
                Continue to sign in
              </WbButton>
            </div>
          )}
        </div>
      )}
    </AuthLayout>
  );
}
