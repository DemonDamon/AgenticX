"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type UiTheme = "system" | "dark" | "light";

const STORAGE_KEY = "agenticx-ui-theme";
const subscribers = new Set<() => void>();

function isDarkMode(theme: UiTheme): boolean {
  if (typeof window === "undefined") return false;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: UiTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isDarkMode(theme)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

function readTheme(): UiTheme {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem(STORAGE_KEY);
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return "system";
}

function setStoredTheme(theme: UiTheme): void {
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  subscribers.forEach((handler) => handler());
}

function subscribe(handler: () => void): () => void {
  subscribers.add(handler);
  return () => subscribers.delete(handler);
}

export function useUiTheme() {
  const [theme, setThemeState] = useState<UiTheme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useLayoutEffect(() => {
    const next = readTheme();
    setThemeState(next);
    applyTheme(next);
    setResolved(isDarkMode(next) ? "dark" : "light");
  }, []);

  useEffect(
    () =>
      subscribe(() => {
        const next = readTheme();
        setThemeState(next);
        setResolved(isDarkMode(next) ? "dark" : "light");
      }),
    []
  );

  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyTheme("system");
      setResolved(query.matches ? "dark" : "light");
    };
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    setStoredTheme(next);
    setResolved(isDarkMode(next) ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => {
    const next: UiTheme = resolved === "dark" ? "light" : "dark";
    setTheme(next);
  }, [resolved, setTheme]);

  return { theme, resolved, setTheme, toggle };
}
