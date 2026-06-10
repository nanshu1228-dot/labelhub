import Link from "next/link";
import { optionalUser } from "@/lib/auth/guards";
import { DEMO_WORKSPACE_PATH } from "@/lib/seeds";
import { LangSwitch } from "./lang-switch";
import { NavAuthControls } from "./nav-auth-controls";

/**
 * Top nav for marketing surfaces.
 *
 * Server-rendered to inline the user's session state in the first paint —
 * judges should see "Sign in / Sign up" or their email immediately, with no
 * flicker. The login state itself is read via `optionalUser()` (returns
 * null when no session).
 *
 * Auth controls + lang switch are split into client subcomponents so the
 * outer wrapper can stay an RSC.
 */
export async function SiteNav() {
  const user = await optionalUser();
  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: "oklch(0.99 0 0 / 0.85)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="max-w-[1280px] mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="0.5"
                y="0.5"
                width="17"
                height="17"
                rx="4"
                stroke="oklch(0.6 0.18 280)"
              />
              <path
                d="M5 4.5V13.5H13"
                stroke="oklch(0.6 0.18 280)"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
            </svg>
            <span
              className="lh-body font-medium"
              style={{ color: "var(--hi)", letterSpacing: "-0.01em" }}
            >
              LabelHub
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <a href="#platform" className="nav-link">
              Platform
            </a>
            <Link href="/admin/forms/new" className="nav-link">
              Designer
            </Link>
            <Link href="/my/tasks" className="nav-link">
              Workbench
            </Link>
            <Link href="/review" className="nav-link">
              Review
            </Link>
            <a href="#templates" className="nav-link">
              Templates
            </a>
            <Link href={DEMO_WORKSPACE_PATH} className="nav-link">
              Demo
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <LangSwitch />
          <NavAuthControls userEmail={user?.email ?? null} />
        </div>
      </div>
    </header>
  );
}
