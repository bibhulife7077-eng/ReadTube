import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { fetchSettings, updateSettings } from "@/lib/api";
import { useAccountStatus, useCachedAccount } from "@/lib/use-account";
import type { FontSize, ThemeName, UserSettings } from "@/lib/types";
import { applyFontSize, applyTheme, readStoredTheme } from "@/components/theme";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const status = useAccountStatus();
  const account = useCachedAccount();
  if (status === "out") return <Navigate to="/login" search={{ next: "/settings" }} />;
  return (
    <SettingsForm
      displayName={account?.displayName ?? null}
      email={account?.primaryEmail ?? null}
      image={account?.profileImageUrl ?? null}
    />
  );
}

function SettingsForm({
  displayName,
  email,
  image,
}: {
  displayName: string | null;
  email: string | null;
  image: string | null;
}) {
  const [settings, setSettings] = useState<UserSettings>({
    defaultMode: "quick",
    fontSize: "md",
    theme: readStoredTheme(),
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchSettings()
      .then((s) => {
        setSettings(s);
        applyTheme(s.theme);
        applyFontSize(s.fontSize);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function persist(next: UserSettings) {
    setSettings(next);
    applyTheme(next.theme);
    applyFontSize(next.fontSize);
    try {
      await updateSettings({ data: next });
      toast.success("Settings saved");
    } catch {
      toast.error("Could not save settings");
    }
  }

  return (
    <AppShell solidHeader>
      <main className="mx-auto w-full max-w-lg px-4 py-12 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Account
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Settings</h1>

        <section className="mt-8 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <div className="flex items-center gap-4">
            {image ? (
              <img
                src={image}
                alt=""
                referrerPolicy="no-referrer"
                className="size-14 rounded-full object-cover"
              />
            ) : (
              <div className="grid size-14 place-items-center rounded-full bg-elevated font-display text-xl">
                {(displayName ?? email ?? "U").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{displayName ?? "Signed in"}</p>
              {email ? (
                <p className="truncate text-sm text-muted">{email}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-5">
            <SignOutButton />
          </div>
        </section>

        <section className="mt-6 space-y-6 rounded-2xl bg-surface p-5 shadow-[var(--shadow-border)]">
          <Field label="Text size" hint="Applies to the transcript.">
            <div className="mt-3 flex gap-2">
              {(["sm", "md", "lg"] as FontSize[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  disabled={!loaded}
                  onClick={() => void persist({ ...settings, fontSize: size })}
                  className={cn(
                    "h-11 flex-1 rounded-xl border text-sm capitalize",
                    settings.fontSize === size
                      ? "border-accent bg-elevated text-fg"
                      : "border-border text-muted hover:text-fg",
                  )}
                >
                  {size === "sm" ? "Small" : size === "md" ? "Medium" : "Large"}
                </button>
              ))}
            </div>
          </Field>

          <Field
            label="Light reading surface"
            hint="Dark is the default. Light uses a paper tone for long sessions."
          >
            <div className="mt-3 flex items-center justify-between gap-4">
              <span className="text-sm text-muted">
                {settings.theme === "light" ? "Paper" : "Ink"}
              </span>
              <Switch
                checked={settings.theme === "light"}
                disabled={!loaded}
                onCheckedChange={(checked) =>
                  void persist({
                    ...settings,
                    theme: (checked ? "light" : "dark") as ThemeName,
                  })
                }
                aria-label="Use light reading surface"
              />
            </div>
          </Field>
        </section>

        <p className="mt-8 text-xs leading-5 text-faint">
          ReadTube stores transcripts of public videos and your history when you are signed in.
        </p>
        <Button asChild variant="ghost" className="mt-2 px-0 text-muted">
          <a href="/">Back to home</a>
        </Button>
      </main>
    </AppShell>
  );
}

function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  if (hasGateSessionMarker()) return null;
  return (
    <button
      type="button"
      disabled={signingOut}
      onClick={() => {
        setSigningOut(true);
        void import("@/lib/auth/client")
          .then((mod) => mod.signOut("/"))
          .catch(() => setSigningOut(false));
      }}
      className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline disabled:opacity-60"
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs leading-5 text-muted">{hint}</p>
      {children}
    </div>
  );
}
