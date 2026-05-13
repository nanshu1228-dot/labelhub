/**
 * Public barrel for the trajectory-annotation UI.
 *
 * Pages import from here, never from individual files. Keeps the public
 * surface small and lets us refactor internals freely.
 */

export { TrajectoryAnnotator } from './trajectory-annotator'
export type { TrajectoryAnnotatorProps } from './trajectory-annotator'

export {
  trajectoryViewFromDb,
  stepMarksFromDb,
  peerMarksFromIaa,
  claudeHintsByStepFromList,
} from './from-db'

export type {
  AttachmentRef,
  ClaudeHint,
  ClaudeHintsByStep,
  Mark,
  PeerMark,
  PeerMarksByStep,
  RubricSpec,
  StepMarksByStep,
  StepView,
  TrajectoryMarks,
  TrajectoryView,
  AnnotateMode,
} from './types'
