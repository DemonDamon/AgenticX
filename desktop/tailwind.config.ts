import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0b1020",
        panel: "#121a2d",
        border: "#27304a"
      }
    }
  },
  plugins: []
};

export default config;
