'use server'

/**
 * Server Actions for provider connections.
 *
 * All write operations route through here so Vault credentials never touch
 * client JavaScript. Demo-mode gated like the step-annotation actions —
 * production should swap the gate for `requireWorkspaceAdmin`.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import {
  createConnection,
  deleteConnection,
  disableConnection,
  enableConnection,
} from '@/lib/proxy/connections'
import { getProviderDef } from '@/lib/proxy/provider-registry'
import { AppError, ValidationError } from '@/lib/errors'

function assertDemoMode() {
  if (process.env.LABELHUB_DEMO_MODE !== 'true') {
    throw new AppError(
      'DEMO_MODE_DISABLED',
      'Connection management requires LABELHUB_DEMO_MODE=true in this build (production should use workspace-admin auth).',
      403,
    )
  }
}

const createSchema = z.object({
  workspaceId: z.string().uuid(),
  providerKind: z.string().min(1),
  displayName: z.string().min(1).max(80),
  apiKey: z.string().min(8).max(500),
  baseUrl: z.string().url().nullable().optional(),
  rateLimitRpm: z.number().int().min(1).max(100_000).nullable().optional(),
})

export async function addConnectionDemo(
  input: z.infer<typeof createSchema>,
): Promise<{ id: string }> {
  assertDemoMode()
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    )
  }
  if (!getProviderDef(parsed.data.providerKind)) {
    throw new ValidationError(`unknown provider_kind: ${parsed.data.providerKind}`)
  }
  const result = await createConnection({
    workspaceId: parsed.data.workspaceId,
    providerKind: parsed.data.providerKind,
    displayName: parsed.data.displayName,
    apiKey: parsed.data.apiKey,
    baseUrl: parsed.data.baseUrl ?? null,
    rateLimitRpm: parsed.data.rateLimitRpm ?? null,
    createdBy: null,
  })
  try {
    revalidatePath(`/workspaces/${parsed.data.workspaceId}/connections`)
  } catch {
    /* ignore outside-request-context */
  }
  return result
}

const idsSchema = z.object({
  workspaceId: z.string().uuid(),
  connectionId: z.string().uuid(),
})

export async function disableConnectionDemo(
  input: z.infer<typeof idsSchema>,
): Promise<void> {
  assertDemoMode()
  const parsed = idsSchema.parse(input)
  await disableConnection(parsed)
  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/connections`)
  } catch {
    /* */
  }
}

export async function enableConnectionDemo(
  input: z.infer<typeof idsSchema>,
): Promise<void> {
  assertDemoMode()
  const parsed = idsSchema.parse(input)
  await enableConnection(parsed)
  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/connections`)
  } catch {
    /* */
  }
}

export async function deleteConnectionDemo(
  input: z.infer<typeof idsSchema>,
): Promise<void> {
  assertDemoMode()
  const parsed = idsSchema.parse(input)
  await deleteConnection(parsed)
  try {
    revalidatePath(`/workspaces/${parsed.workspaceId}/connections`)
  } catch {
    /* */
  }
}
