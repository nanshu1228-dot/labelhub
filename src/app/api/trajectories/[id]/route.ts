import { NextResponse, type NextRequest } from 'next/server'
import { authenticateApiKey } from '@/lib/auth/api-key'
import { AppError, ForbiddenError, NotFoundError } from '@/lib/errors'
import { extractRequestMeta, logApiRequest } from '@/lib/api/audit'
import { getTrajectoryWithSteps } from '@/lib/queries/trajectories'

/**
 * GET /api/trajectories/[id]
 *
 * Single-trajectory read: trajectory row + every step + the tool_providers
 * referenced by tool_call steps. Returns the same shape the detail page
 * consumes, ready to be piped into the user's own annotation tool, training
 * dataset, or eval rig.
 *
 * Auth: workspace API key. We verify the trajectory belongs to the key's
 * workspace (anti-spoof — you can't read someone else's capture by guessing
 * a UUID).
 *
 * Response: `{ trajectory, steps, toolProviders: { [id]: provider } }`.
 * Each step's `toolProviderId` (if non-null) looks up into `toolProviders`.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const start = Date.now()
  const { userAgent, remoteAddr } = extractRequestMeta(request)
  let workspaceId: string | null = null
  let apiKeyId: string | null = null
  let status = 200
  let errorCode: string | null = null
  let response: NextResponse | undefined
  let responseBytes = 0

  try {
    const auth = await authenticateApiKey(request)
    if ('error' in auth) throw new AppError(auth.code, auth.error, 401)
    workspaceId = auth.workspaceId
    apiKeyId = auth.apiKeyId

    const { id } = await ctx.params

    const bundle = await getTrajectoryWithSteps(id)
    if (!bundle) throw new NotFoundError('Trajectory')

    // Anti-spoof: never let workspace A read a trajectory that lives in workspace B,
    // even if the caller knows its UUID.
    if (bundle.trajectory.workspaceId !== auth.workspaceId) {
      throw new ForbiddenError('Trajectory does not belong to this workspace.')
    }

    const body = JSON.stringify({
      trajectory: bundle.trajectory,
      steps: bundle.steps,
      toolProviders: Object.fromEntries(bundle.providersById.entries()),
    })
    responseBytes = body.length
    response = new NextResponse(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  } catch (e: unknown) {
    if (e instanceof AppError) {
      status = e.status
      errorCode = e.code
      response = NextResponse.json(
        { error: { message: e.message, code: e.code } },
        { status: e.status },
      )
    } else {
      status = 500
      errorCode = 'INTERNAL'
      const msg = e instanceof Error ? e.message : 'Unknown error'
      response = NextResponse.json(
        { error: { message: msg, code: 'INTERNAL' } },
        { status: 500 },
      )
    }
  }

  logApiRequest({
    workspaceId,
    apiKeyId,
    endpoint: 'GET /api/trajectories/[id]',
    method: 'GET',
    status,
    errorCode,
    durationMs: Date.now() - start,
    remoteAddr,
    userAgent,
    responseBytes,
  })

  return response!
}
