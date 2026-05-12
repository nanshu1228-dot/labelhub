import {
  canonicalTrajectorySchema,
  validateTrajectory,
  type CanonicalTrajectory,
  type TrajectorySource,
} from '../schema'

/**
 * Canonical adapter — pass-through with validation.
 *
 * Publishers using our SDK or sending us already-canonical payloads
 * hit this path. Just validates and (optionally) overrides source.
 */
export function adaptCanonical(
  rawInput: unknown,
  overrides?: { source?: TrajectorySource; agentName?: string },
): CanonicalTrajectory {
  // First-pass: ensure outer shape is sane (cheap, before content validation).
  const parsed = canonicalTrajectorySchema.parse(rawInput)
  const withOverrides: CanonicalTrajectory = {
    ...parsed,
    source: overrides?.source ?? parsed.source,
    agentName: overrides?.agentName ?? parsed.agentName,
  }
  // Two-stage: validate kind-specific content too.
  return validateTrajectory(withOverrides)
}
