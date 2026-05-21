import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  /**
   * Finals P1 D6 — Designer/Renderer decoupling.
   *
   * The Renderer (src/components/form-renderer/**) consumes serialized
   * FormSchemas at runtime; it must NOT pull in the Designer UI
   * (canvas, palette, property panels) because those bundle the entire
   * DnD + Jotai + editing layer that Labelers don't need.
   *
   * Shared widget code lives under src/components/form-materials/**;
   * both Designer and Renderer import from there. Schema / linkage /
   * validation logic lives under src/lib/form-designer/** and is
   * library-side (server-safe), so the Renderer may import it.
   *
   * This rule is the spec's "渲染器与设计器解耦" gate. Violations are
   * flagged as errors so CI catches a slip immediately.
   */
  {
    files: ["src/components/form-renderer/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/form-designer/**"],
              message:
                "form-renderer must not import Designer UI. Shared widget code lives in @/components/form-materials/*; schema + linkage + validation live in @/lib/form-designer/*.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
