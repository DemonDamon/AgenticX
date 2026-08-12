import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--surface-base)",
        panel: "var(--surface-panel)",
        // Named tokens (no /opacity). CSS vars already carry alpha; Tailwind
        // `/70` on `var(--…)` emits invalid `rgb(var(--…) / 0.7)` and falls
        // back to preflight gray-200 — bright white lines on dark themes.
        border: {
          DEFAULT: "var(--border-subtle)",
          muted: "var(--border-muted)",
          strong: "var(--border-strong)",
        },
        text: {
          primary: "var(--text-primary)",
          strong: "var(--text-strong)",
          muted: "var(--text-muted)",
          subtle: "var(--text-subtle)",
          faint: "var(--text-faint)",
        },
        surface: {
          base: "var(--surface-base)",
          panel: "var(--surface-panel)",
          popover: "var(--surface-popover)",
          sidebar: "var(--surface-sidebar)",
          topbar: "var(--surface-topbar)",
          messages: "var(--surface-messages)",
          composer: "var(--surface-composer)",
          card: "var(--surface-card)",
          cardStrong: "var(--surface-card-strong)",
          hover: "var(--surface-hover)",
          bubble: "var(--surface-bubble)",
          bubbleUser: "var(--surface-bubble-user)",
        },
        status: {
          success: "var(--status-success)",
          warning: "var(--status-warning)",
          error: "var(--status-error)",
        },
        btnPrimary: {
          DEFAULT: "var(--ui-btn-primary-bg)",
          hover: "var(--ui-btn-primary-bg-hover)",
          text: "var(--ui-btn-primary-text)",
        },
      },
      // Preflight `*, ::before, ::after { border-color }` must use theme token,
      // not gray-200, or any failed border-* /opacity utility looks neon-white.
      borderColor: {
        DEFAULT: "var(--border-subtle)",
      },
      transitionDuration: {
        fast: "var(--ds-dur-fast)",
        normal: "var(--ds-dur-normal)",
        slow: "var(--ds-dur-slow)",
      },
      transitionTimingFunction: {
        out: "var(--ds-ease-out)",
        spring: "var(--ds-ease-spring)",
      },
      zIndex: {
        modal: "var(--ds-layer-modal)",
        toast: "var(--ds-layer-toast)",
      },
    },
  },
  plugins: []
};

export default config;
