import { useState } from "react";
import { cn } from "@/lib/utils";
import { SignInForm } from "./SignInForm";
import { SignUpForm } from "./SignUpForm";
import { GoogleButton } from "./GoogleButton";

export function AuthTabs({ initial = "in" }: { initial?: "in" | "up" }) {
  const [tab, setTab] = useState<"in" | "up">(initial);
  return (
    <div>
      <div className="mb-5 inline-flex w-full rounded-md bg-muted p-1">
        {(["in", "up"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
              tab === k
                ? "bg-card text-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {k === "in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>
      {tab === "in" ? <SignInForm /> : <SignUpForm />}
      <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>
      <GoogleButton label={tab === "in" ? "Sign in with Google" : "Sign up with Google"} />
    </div>
  );
}
