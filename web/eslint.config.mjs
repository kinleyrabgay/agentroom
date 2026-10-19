import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Design guardrails: status colours come from tone tokens, and text is never below 12px.
  {
    files: ["app/**/*.tsx", "components/**/*.tsx", "features/**/*.tsx", "hooks/**/*.ts", "lib/**/*.ts"],
    ignores: ["components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/\\b(bg|text|border|ring|fill|stroke|from|to)-(amber|red|emerald|sky|violet|green|yellow|blue|orange|rose|purple|pink|indigo|cyan|teal|lime)-\\d{2,3}/]",
          message: "Use a tone (tone-warning tone-soft, ToneBadge, Callout, text-danger…) instead of a raw palette colour.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(bg|text|border|ring|fill|stroke|from|to)-(amber|red|emerald|sky|violet|green|yellow|blue|orange|rose|purple|pink|indigo|cyan|teal|lime)-\\d{2,3}/]",
          message: "Use a tone (tone-warning tone-soft, ToneBadge, Callout, text-danger…) instead of a raw palette colour.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
