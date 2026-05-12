import type { EventBase } from './types'

/**
 * A projection derives a read model from the event log.
 * Pure: same events in → same state out. Replay-safe.
 */
export interface Projection<TState> {
  readonly initial: TState
  readonly apply: (state: TState, event: EventBase) => TState
}

export function fold<TState>(
  events: readonly EventBase[],
  proj: Projection<TState>,
): TState {
  return events.reduce((s, e) => proj.apply(s, e), proj.initial)
}
