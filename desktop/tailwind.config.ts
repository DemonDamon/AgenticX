import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "var(--surface-base)",
        panel: "var(--surface-panel)",
        border: "var(--border-subtle)",
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
