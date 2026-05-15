import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getWorkspaceById } from '@/lib/queries/workspaces'
import { listConnections } from '@/lib/proxy/connections'
import { isVaultAvailable } from '@/lib/proxy/vault'
import { listProviders } from '@/lib/proxy/provider-registry'
import {
  optionalUser,
  requireWorkspaceAdmin,
} from '@/lib/auth/guards'
import { ConnectionFormClient } from '@/components/connections/connection-form-client'
import { ConnectionRowClient } from '@/components/connections/connection-row-client'

export const metadata: Metadata = {
  title: 'Provider Connections — LabelHub',
}

/**
 * /workspaces/[id]/connections
 *
 * Manage upstream LLM provider credentials. Each connection = (provider_kind,
 * display_name, vault-stored API key, optional base URL, optional rate limit).
 * The proxy routes look these up at request time; without one, they fall
 * back to env vars (legacy path).
 */
export default async function ConnectionsPage(
  props: PageProps<'/workspaces/[id]/connections'>,
) {
  const { id: workspaceId } = await props.params

  // Admin-only — provider connections hold upstream LLM API keys
  // (vault-encrypted but still operational secrets). Even read access
  // to the list reveals what providers are wired up.
  const me = await optionalUser()
  if (!me) redirect(`/signin?next=/workspaces/${workspaceId}/connections`)
  try {
    await requireWorkspaceAdmin(workspaceId)
  } catch {
    notFound()
  }

  let workspaceName = 'workspace'
  let dbError: string | null = null
  let connections: Awaited<ReturnType<typeof listConnections>> = []
  let vaultOk = false

  try {
    const workspace = await getWorkspaceById(workspaceId)
    if (!workspace) notFound()
    workspaceName = workspace.name
    ;[connections, vaultOk] = await Promise.all([
      listConnections(workspaceId),
      isVaultAvailable(),
    ])
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  const demoMode = process.env.LABELHUB_DEMO_MODE === 'true'
  const providers = listProviders()

  return (
    <div className="app-light min-h-screen">
      <Header workspaceId={workspaceId} workspaceName={workspaceName} />

      <main className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="mb-8">
          <div className="lbl mb-2">§ PROVIDER CONNECTIONS</div>
          <h1 className="ts-32" style={{ color: 'var(--hi)' }}>
            Connections
          </h1>
          <p className="ts-13 mt-1" style={{ color: 'var(--mute)' }}>
            Per-workspace credentials for upstream LLM APIs. Keys are stored
            encrypted in Supabase Vault.
          </p>
        </div>

        {!vaultOk && (
          <VaultBanner />
        )}

        {dbError ? (
          <DbError message={dbError} />
        ) : (
          <div className="flex flex-col gap-8">
            <section>
              <SectionHeader
                title="ACTIVE CONNECTIONS"
                hint={`${connections.filter((c) => c.enabled === 'true').length} enabled / ${connections.length} total`}
              />
              {connections.length === 0 ? (
                <EmptyConnections />
              ) : (
                <div className="flex flex-col gap-2">
                  {connections.map((c) => (
                    <ConnectionRowClient
                      key={c.id}
                      workspaceId={workspaceId}
                      connection={{
                        id: c.id,
                        providerKind: c.providerKind,
                        displayName: c.displayName,
                        baseUrl: c.baseUrl,
                        keyDisplay: c.keyDisplay,
                        rateLimitRpm: c.rateLimitRpm,
                        enabled: c.enabled === 'true',
                        createdAt: c.createdAt.toISOString(),
                        lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            {demoMode && vaultOk && (
              <section>
                <SectionHeader title="ADD A CONNECTION" />
                <ConnectionFormClient
                  workspaceId={workspaceId}
                  providers={providers.map((p) => ({
                    kind: p.kind,
                    label: p.label,
                    defaultBaseUrl: p.defaultBaseUrl,
                  }))}
                />
              </section>
            )}

            {!demoMode && (
              <p
                className="ts-13"
                style={{ color: 'var(--mute)' }}
              >
                Connection management is disabled because{' '}
                <span className="mono">LABELHUB_DEMO_MODE</span> is not{' '}
                <span className="mono">true</span>. Production deployments
                should run this surface behind workspace-admin authentication.
              </p>
            )}

            <section>
              <SectionHeader title="ENV-VAR FALLBACK (LEGACY)" />
              <div
                className="rounded-xl px-4 py-3 ts-13"
                style={{
                  border: '1px solid var(--line)',
                  background: 'var(--panel2)',
                  color: 'var(--mute)',
                }}
              >
                If a provider has NO active connection above, the proxy falls
                back to these env vars on the server:
                <ul className="mt-2 flex flex-col gap-0.5">
                  {providers.map((p) => (
                    <li key={p.kind} className="mono ts-12">
                      <span style={{ color: 'var(--accent)' }}>{p.kind}</span>{' '}
                      → <span style={{ color: 'var(--hi)' }}>{p.envFallback}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

function Header({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string
  workspaceName: string
}) {
  return (
    <header
      className="hairline-b sticky top-0 z-10"
      style={{ background: 'var(--panel)' }}
    >
      <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 py-3">
        <nav
          className="ts-12 mono flex items-center gap-1.5"
          style={{ color: 'var(--mute2)' }}
        >
          <Link
            href={`/workspaces/${workspaceId}`}
            className="truncate-1 hover:underline"
            style={{ color: 'var(--text)', maxWidth: 200 }}
          >
            {workspaceName}
          </Link>
          <span>/</span>
          <span style={{ color: 'var(--hi)' }}>connections</span>
        </nav>
        <Link
          href="/"
          className="ts-13 mono"
          style={{ color: 'var(--hi)' }}
          aria-label="LabelHub"
        >
          <span style={{ color: 'var(--accent)' }}>§</span> labelhub
        </Link>
      </div>
    </header>
  )
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <div className="lbl">§ {title}</div>
      {hint && (
        <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

function VaultBanner() {
  return (
    <div
      className="mb-6 rounded-xl px-4 py-3"
      style={{
        background: 'oklch(0.7 0.14 75 / 0.08)',
        border: '1px solid oklch(0.7 0.14 75 / 0.4)',
      }}
    >
      <div
        className="ts-13 mono mb-1"
        style={{ color: 'var(--warn)', letterSpacing: '0.04em' }}
      >
        ⚠ SUPABASE VAULT NOT ENABLED
      </div>
      <p className="ts-13" style={{ color: 'var(--text)' }}>
        Provider API keys need encrypted storage. Enable Vault via{' '}
        <span className="mono" style={{ color: 'var(--hi)' }}>
          Supabase Dashboard → Database → Extensions → search &quot;vault&quot;
          → Enable
        </span>
        , then refresh this page.
      </p>
    </div>
  )
}

function EmptyConnections() {
  return (
    <div
      className="text-center py-10 px-6 rounded-xl"
      style={{ border: '1px dashed var(--line2)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--mute2)', letterSpacing: '0.05em' }}
      >
        § NO CONNECTIONS YET
      </div>
      <p className="ts-13" style={{ color: 'var(--mute)' }}>
        The proxy is using env-var fallbacks. Add a connection below to
        manage keys per-workspace + apply rate limits.
      </p>
    </div>
  )
}

function DbError({ message }: { message: string }) {
  return (
    <div
      className="p-6 rounded-xl"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div
        className="ts-13 mono mb-2"
        style={{ color: 'var(--danger)', letterSpacing: '0.05em' }}
      >
        § DATABASE NOT REACHABLE
      </div>
      <pre
        className="mt-2 ts-12 mono p-3 overflow-auto whitespace-pre-wrap"
        style={{
          background: 'var(--code-bg)',
          border: '1px solid var(--code-line)',
          color: 'var(--code-text)',
          borderRadius: 8,
        }}
      >
        {message}
      </pre>
    </div>
  )
}
