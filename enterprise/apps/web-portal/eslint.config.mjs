import i18next from "eslint-plugin-i18next";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
export default tseslint.config(
  {
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/__fixtures__/**", ".next/**"],
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "warn",
        {
          mode: "jsx-text-only",
          callees: {
            exclude: ["t", "tc", "useTranslations", "getTranslations", "usePortalCopy"],
          },
          "jsx-attributes": {
            exclude: [
              "className",
              "id",
              "href",
              "type",
              "name",
              "accept",
              "placeholder",
              "aria-hidden",
              "data-testid",
              "key",
              "variant",
              "size",
              "side",
              "align",
              "aria-label",
            ],
          },
          "jsx-components": {
            exclude: ["SelectItem"],
          },
          words: {
            exclude: [
              "Machi",
              "AgenticX",
              "New chat",
              "Deep research",
              "Send",
              "Email",
              "deepseek-chat",
              "moonshot-v1-8k",
              "gpt-4o-mini",
              "Machi AI",
              "MinerU",
              "Textract",
              "✓",
            ],
          },
        },
      ],
    },
  }
);
