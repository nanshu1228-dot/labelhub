import { type UserCalibration } from '@/lib/queries/gold-standards'
import { SectionHeader } from '@/components/ui/section-header'
import { EmptyLeaderboardCard, LeaderboardTable, Pct } from './shared'

// ─── Calibration leaderboard ─────────────────────────────────────────────

export function CalibrationLeaderboard({
  workspaceId: _workspaceId,
  rows,
  goldCount,
}: {
  workspaceId: string
  rows: UserCalibration[]
  goldCount: number
}) {
  return (
    <section>
      <SectionHeader
        title="CALIBRATION VS GOLD"
        hint={
          goldCount === 0
            ? 'no golds yet — leaderboard will populate once you promote'
            : `${rows.length} rater${rows.length === 1 ? '' : 's'} scored against ${goldCount} gold${goldCount === 1 ? '' : 's'}`
        }
      />
      {rows.length === 0 ? (
        <EmptyLeaderboardCard
          message={
            goldCount === 0
              ? 'No gold standards exist yet — calibration scores need ground truth to compare against.'
              : 'No raters have annotated the gold trajectories yet. Once they do, this leaderboard will rank them by how often they match the reference answers.'
          }
        />
      ) : (
        <LeaderboardTable
          headers={['rater', 'score', 'matched', 'diverged', 'golds covered']}
          rows={rows.map((r) => {
            const pct = Math.round(r.score * 100)
            const tone =
              r.score >= 0.8
                ? 'success'
                : r.score >= 0.6
                  ? 'default'
                  : r.score >= 0.4
                    ? 'warn'
                    : 'danger'
            return {
              key: r.userId,
              cells: [
                r.displayName ?? r.userId.slice(0, 8),
                <Pct key="pct" value={pct} tone={tone} />,
                String(r.matched),
                String(r.diverged),
                String(r.goldsCovered),
              ],
            }
          })}
        />
      )}
    </section>
  )
}
