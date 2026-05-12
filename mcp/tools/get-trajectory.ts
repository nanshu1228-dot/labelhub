import { z } from 'zod'
import { runGetTrajectory } from '../../scripts/debug/get-trajectory'
import { jsonResult } from './_format'
import type { ToolModule } from './_types'

const shape = {
  id: z.string().uuid().describe('Trajectory UUID.'),
}

type Args = { id: string }

export const getTrajectoryTool: ToolModule<Args> = {
  name: 'get_trajectory',
  config: {
    title: 'Get trajectory + steps',
    description:
      'Return one trajectory plus every step in sequence: kind, full content jsonb, latency, token counts, resolved tool_provider name + identifier. Use when list_trajectories points at a row that needs deeper inspection.',
    inputSchema: shape,
  },
  handler: async (args) => jsonResult(await runGetTrajectory(args)),
}
