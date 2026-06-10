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
  /**
   * Dual-identity boundary — annotation-core must not depend on the
   * LLM-gateway sub-packages (see ARCHITECTURE.md §1 / §11.3).
   *
   * LabelHub is two products in one repo: the annotation platform and a
   * gateway layer (proxy capture, trajectories, billing/settlement). The
   * gateway may read from core, but core must stay ignorant of the gateway
   * so the annotation product could ship without it. proxy/** and
   * trajectories/** are already gateway-clean; this fences the core
   * library slices so a future accidental import is caught in CI rather
   * than discovered later.
   *
   * Scope is the already-clean core library slices. The previously-known
   * crossing — actions/annotations.ts → lib/billing (invite-reward + payout
   * accrual on approval) — has now been INVERTED through the core event bus
   * (core dispatches `annotation.approved`; billing subscribes at boot via
   * the instrumentation composition root). annotations.ts is fenced in its
   * own block below to keep that inversion from regressing.
   */
  {
    files: [
      "src/lib/quality/**/*.{ts,tsx}",
      "src/lib/export/**/*.{ts,tsx}",
      "src/lib/import/**/*.{ts,tsx}",
      "src/lib/form-designer/**/*.{ts,tsx}",
      "src/lib/templates/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/proxy/**",
                "@/lib/trajectories/**",
                "@/lib/billing/**",
              ],
              message:
                "annotation-core must not import the LLM-gateway layer (proxy / trajectories / billing). The gateway depends on core, never the reverse — see ARCHITECTURE.md §1.",
            },
          ],
        },
      ],
    },
  },
  /**
   * Lock the inverted core→billing seam. actions/annotations.ts is the core
   * acceptance action; it must NOT reach into the billing/gateway layer
   * directly — on approval it dispatches `annotation.approved` on the core
   * event bus and the billing gateway reacts (registered at boot via
   * src/instrumentation.ts → @/lib/billing/init). This fence catches a
   * regression that would re-couple core to billing. See ARCHITECTURE.md §11.3.
   */
  {
    files: ["src/lib/actions/annotations.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/proxy/**",
                "@/lib/trajectories/**",
                "@/lib/billing/**",
                "@/lib/actions/billing/**",
              ],
              message:
                "actions/annotations.ts must stay ignorant of the billing/gateway layer — dispatch a domain event (dispatchDomainEvent) and let billing subscribe instead. See ARCHITECTURE.md §11.3.",
            },
          ],
        },
      ],
    },
  },
  /**
   * Honor the leading-underscore convention for INTENTIONALLY unused
   * bindings — unused args/vars/caught-errors prefixed with `_` (and
   * `..._rest` destructuring) are deliberate (signature shape, future
   * params, ignored tuple slots) and should not be flagged. This is the
   * standard typescript-eslint configuration of no-unused-vars; the
   * codebase already adopts the `_name` convention throughout.
   */
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
