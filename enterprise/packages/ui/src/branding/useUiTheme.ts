"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type UiTheme = "system" | "dark" | "light";

const STORAGE_KEY = "agenticx-ui-theme";
const subscribers = new Set<() => void>();

function isDarkMode(theme: UiTheme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: UiTheme): void {
  const root = document.documentElement;
  if (isDarkMode(theme)) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

function readTheme(): UiTheme {
  if (typeof window === "undefined") return "dark";
  const value = window.localStorage.getItem(STORAGE_KEY);
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }
  return "dark";
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
  const [theme, setThemeState] = useState<UiTheme>("dark");

  useLayoutEffect(() => {
    const next = readTheme();
    setThemeState(next);
    applyTheme(next);
  }, []);

  useEffect(() => subscribe(() => setThemeState(readTheme())), []);

  useEffect(() => {
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: UiTheme) => {
    setThemeState(next);
    setStoredTheme(next);
  }, []);

  return { theme, setTheme };
}

