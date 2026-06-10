import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

import { users, workspaces } from './core'
import { trajectorySteps } from './trajectories'

// =================================================================
// API request log — every authenticated REST request to /api/ingest/* or
// /api/eval-runs gets a row here. Powers the API Usage dashboard +
// debugging + abuse detection.
//
// IP is stored as a SHA-256 prefix hash (16 hex chars) so we can detect
// patterns without retaining raw IPs (PII).
// =================================================================
export const apiRequestLog = pgTable(
  'api_request_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    /** Null if request was authenticated via user session (Eval-Run path) */
    apiKeyId: uuid('api_key_id').references(() => workspaceApiKeys.id),
    /** Null if request was machine-to-machine via API key */
    userId: uuid('user_id').references(() => users.id),
    /** "POST /api/ingest/trajectories" — endpoint name for grouping */
    endpoint: text('endpoint').notNull(),
    method: text('method').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms'),
    /** SHA-256 prefix (16 hex chars) of remote IP. No raw IP retained. */
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    payloadBytes: integer('payload_bytes'),
    responseBytes: integer('response_bytes'),
    /** Matches AppError.code on failure; null on success */
    errorCode: text('error_code'),
    ts: timestamp('ts').defaultNow().notNull(),
  },
  (table) => ({
    wsTsIdx: index('api_log_ws_ts_idx').on(table.workspaceId, table.ts),
    keyTsIdx: index('api_log_key_ts_idx').on(table.apiKeyId, table.ts),
    endpointTsIdx: index('api_log_endpoint_ts_idx').on(
      table.endpoint,
      table.ts,
    ),
  }),
)

// =================================================================
// Workspace API keys — for machine-to-machine (SDK / REST ingest) auth.
// Distinct from Supabase user sessions; workspace-scoped, hashed at rest.
// =================================================================
export const workspaceApiKeys = pgTable(
  'workspace_api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    name: text('name').notNull(), // user-readable label
    /** SHA-256 of the full bearer token; plain text shown ONCE on creation. */
    keyHash: text('key_hash').notNull().unique(),
    /** First 8 chars of the plain key for UI display (lh_ws_abcdefgh…). */
    prefix: text('prefix').notNull(),
    createdBy: uuid('created_by')
      .references(() => users.id)
      .notNull(),
    /**
     * Optional per-key RPM cap. NULL = no per-key limit (only the
     * connection-level limit applies). When set, the proxy enforces
     * BOTH: connection's limit AND this key's limit, whichever bites
     * first.
     *
     * Lets publishers issue a wide-open key for their own backend +
     * narrow keys for third-party integrations without having to fork
     * provider connections.
     */
    rateLimitRpm: integer('rate_limit_rpm'),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceIdx: index('api_keys_workspace_idx').on(table.workspaceId),
  }),
)

// =================================================================
// Provider connections — per-workspace credentials for upstream LLM APIs.
//
// Replaces the env-var pattern (ANTHROPIC_API_KEY / DOUBAO_API_KEY) for
// scalable multi-tenant operation: each workspace can have its own keys,
// own base URLs, own rate limits.
//
// The actual API key NEVER lives in this table. We store `vaultRef` — the
// name of a Supabase Vault secret. Reading the plaintext key requires the
// service-role connection + a query against `vault.decrypted_secrets`.
// =================================================================
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** 'doubao' | 'anthropic' | 'openai' | 'deepseek' | 'qwen' | 'moonshot' | ... */
    providerKind: text('provider_kind').notNull(),
    /** Human-readable label, unique per workspace (e.g. "Doubao production"). */
    displayName: text('display_name').notNull(),
    /** Optional override of the provider's default base URL. */
    baseUrl: text('base_url'),
    /**
     * Reference to a Supabase Vault secret name. The plaintext key is fetched
     * via `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1`.
     */
    vaultRef: text('vault_ref').notNull(),
    /** Last-4 chars of the plain key for UI display (e.g. "…3a4b"). */
    keyDisplay: text('key_display'),
    /** Per-connection rate limits. null = no cap. */
    rateLimitRpm: integer('rate_limit_rpm'),
    rateLimitTpm: integer('rate_limit_tpm'),
    enabled: text('enabled').default('true').notNull(),
    rotatedAt: timestamp('rotated_at'),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (table) => ({
    wsKindIdx: index('prov_conn_ws_kind_idx').on(
      table.workspaceId,
      table.providerKind,
    ),
    wsNameUniq: uniqueIndex('prov_conn_ws_name_uniq').on(
      table.workspaceId,
      table.displayName,
    ),
  }),
)

// =================================================================
// Provider rate log — sliding-window bookkeeping for rate limits.
// Each row = one upstream call. The route handler counts rows in the
// last 60s (and sums tokensUsed for TPM) before deciding to accept the
// next call.
// =================================================================
export const providerRateLog = pgTable(
  'provider_rate_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    connectionId: uuid('connection_id')
      .references(() => providerConnections.id)
      .notNull(),
    /**
     * Which API key triggered this call. Lets the rate-limiter count by
     * (connection × key) AND by (key alone), so a runaway third-party key
     * gets capped without affecting siblings sharing the same connection.
     * Nullable for forward-compat with old logged rows / non-keyed
     * call paths (e.g. internal admin scripts).
     */
    apiKeyId: uuid('api_key_id').references(() => workspaceApiKeys.id),
    ts: timestamp('ts').defaultNow().notNull(),
    tokensUsed: integer('tokens_used').default(0).notNull(),
  },
  (table) => ({
    connTsIdx: index('rate_log_conn_ts_idx').on(table.connectionId, table.ts),
  }),
)

// =================================================================
// Tool providers — per-workspace catalog of every tool agents use.
// Auto-created from observed traces (source='inferred'); publishers can
// upgrade to source='declared' with full manifest later.
// =================================================================
export const toolProviders = pgTable(
  'tool_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id)
      .notNull(),
    /** 'function' | 'mcp' | 'skill' | 'cli' | 'api' (validated in code, not DB) */
    kind: text('kind').notNull(),
    /** Canonical identifier, e.g. 'mcp:postgres-query/execute' or 'cli:./deploy.sh' */
    identifier: text('identifier').notNull(),
    name: text('name').notNull(),
    manifest: jsonb('manifest').default({}).notNull(),
    /** 'inferred' (auto from traces) | 'declared' (publisher uploaded) */
    source: text('source').default('inferred').notNull(),
    status: text('status').default('active').notNull(),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  },
  (table) => ({
    // Composite unique: one identifier per workspace (enables upsert on conflict)
    wsIdentifierUniq: uniqueIndex('tool_providers_ws_id_uniq').on(
      table.workspaceId,
      table.identifier,
    ),
    wsKindIdx: index('tool_providers_ws_kind_idx').on(
      table.workspaceId,
      table.kind,
    ),
  }),
)

export const toolProvidersRelations = relations(toolProviders, ({ many }) => ({
  steps: many(trajectorySteps),
}))
