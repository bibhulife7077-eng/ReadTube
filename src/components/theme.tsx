import { useEffect, useState, type ComponentType } from "react";
import type { FontSize, ThemeName } from "@/lib/types";

const KEY = "readtube.theme";
const FONT_KEY = "readtube.font";

export function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "dark";
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: ThemeName) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.classList.toggle("light", theme === "light");
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

export function readStoredFontSize(): FontSize {
  if (typeof window === "undefined") return "md";
  try {
    const v = window.localStorage.getItem(FONT_KEY);
    return v === "sm" || v === "lg" ? v : "md";
  } catch {
    return "md";
  }
}

export function applyFontSize(size: FontSize) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.font = size;
  try {
    window.localStorage.setItem(FONT_KEY, size);
  } catch {
    /* ignore */
  }
}

export function ThemeBoot() {
  useEffect(() => {
    applyTheme(readStoredTheme());
    applyFontSize(readStoredFontSize());
  }, []);
  return null;
}

export function ThemeToaster() {
  const [theme, setTheme] = useState<ThemeName>("dark");
  const [Toaster, setToaster] = useState<ComponentType<{
    theme: ThemeName;
    position: "bottom-center";
    toastOptions: { className: string };
  }> | null>(null);
  useEffect(() => {
    const sync = () => {
      setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    };
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    let cancelled = false;
    void import("sonner").then((mod) => {
      if (!cancelled) setToaster(() => mod.Toaster);
    });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, []);
  if (!Toaster) return null;
  return (
    <Toaster
      theme={theme}
      position="bottom-center"
      toastOptions={{
        className:
          "!bg-elevated !text-fg !border-border !shadow-[var(--shadow-border)]",
      }}
    />
  );
}
