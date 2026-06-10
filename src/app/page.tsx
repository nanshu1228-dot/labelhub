import { redirect } from "next/navigation";
import { SiteNav } from "@/components/site/nav";
import { Hero } from "@/components/site/hero";
import { TemplateCards } from "@/components/site/template-cards";
import { SiteFooter } from "@/components/site/site-footer";
import { oauthCallbackPathFromSearchParams } from "@/lib/auth/oauth-entrypoint";
import { getLandingStats } from "@/lib/queries/landing-stats";

// Force per-request rendering so the live stats are accurate. Without
// this Next will happily serve a build-time render with stats=null
// (Phase-15 reflection fix: prod was showing "—" everywhere because
// the build had no DATABASE_URL at prerender time).
export const dynamic = "force-dynamic";

/**
 * Landing — finals-facing platform entry.
 *
 * The public first impression must match the finals spec: Owner
 * publishes tasks, Labelers annotate, AI pre-reviews, Reviewers accept
 * or send back, and admins export datasets. The gateway thesis still
 * exists deeper in the product, but it is no longer the first thing a
 * judge sees.
 */
export default async function HomePage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = (await props.searchParams) ?? {};
  const oauthCallbackPath = oauthCallbackPathFromSearchParams(searchParams);
  if (oauthCallbackPath) redirect(oauthCallbackPath);

  const stats = await getLandingStats().catch(() => null);
  return (
    // The marketing surface now renders on the light `.app-light` palette
    // (matching the signed-in app and the already-light Hero) instead of
    // the legacy dark landing. Wrapping here gives every section the white
    // background + activates the `.app-light` overrides for the landing-only
    // utility classes (nav-link, mode-tag, vote-bar, chart axes, …).
    <div className="app-light">
      <SiteNav />
      <main>
        <Hero stats={stats} />
        <TemplateCards />
      </main>
      <SiteFooter />
    </div>
  );
}
