import type {
  PairRubricRow,
  ArenaDimensionRow,
  ArenaOverallRow,
} from '@/lib/queries/pair-iaa'

/**
 * Pair/arena IAA condensed for the /quality dashboard. Disputes page
 * has the full breakdown; here we just summarize "how noisy is each
 * rubric / dimension" so the admin can spot drift in one glance.
 */
export function PairIaaQualitySection({
  iaa,
}: {
  iaa: {
    mode: 'pair-rubric' | 'arena-gsb' | 'unsupported'
    pairRubric: PairRubricRow[]
    arenaDimensions: ArenaDimensionRow[]
    arenaOverall: ArenaOverallRow | null
  }
}) {
  if (iaa.mode === 'pair-rubric') {
    return (
      <section>
        <div className="lbl mb-2">§ RUBRIC AGREEMENT (multi-rater topics)</div>
        {iaa.pairRubric.length === 0 ? (
          <EmptyIaaCard kind="rubric" />
        ) : (
          <SimpleAgreementTable
            rows={iaa.pairRubric.map((r) => ({
              key: r.rubricId,
              multi: r.multiRaterTopics,
              disputed: r.disputedTopics,
              rate: r.agreementRate,
            }))}
          />
        )}
      </section>
    )
  }
  if (iaa.mode === 'arena-gsb') {
    return (
      <>
        <section>
          <div className="lbl mb-2">§ DIMENSION AGREEMENT (multi-rater topics)</div>
          {iaa.arenaDimensions.length === 0 ? (
            <EmptyIaaCard kind="dimension" />
          ) : (
            <SimpleAgreementTable
              rows={iaa.arenaDimensions.map((r) => ({
                key: r.dimensionId,
                multi: r.multiRaterTopics,
                disputed: r.disputedTopics,
                rate: r.agreementRate,
              }))}
            />
          )}
        </section>
        {iaa.arenaOverall && iaa.arenaOverall.multiRaterTopics > 0 && (
          <section>
            <div className="lbl mb-2">§ OVERALL VERDICT</div>
            <div
              className="rounded-md p-4 ts-13"
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--line)',
              }}
            >
              <span style={{ color: 'var(--mute)' }}>
                multi-rater topics:{' '}
              </span>
              <strong style={{ color: 'var(--text)' }}>
                {iaa.arenaOverall.multiRaterTopics}
              </strong>
              <span style={{ color: 'var(--mute)' }}> · agreement: </span>
              <strong style={{ color: 'var(--text)' }}>
                {iaa.arenaOverall.multiRaterTopics === 0
                  ? '—'
                  : `${Math.round((1 - iaa.arenaOverall.disputedTopics / iaa.arenaOverall.multiRaterTopics) * 100)}%`}
              </strong>
              <span style={{ color: 'var(--mute)' }}> · tally: </span>
              <span className="mono ts-12">
                A {iaa.arenaOverall.byVerdict.a_better} / tie{' '}
                {iaa.arenaOverall.byVerdict.tie} / B{' '}
                {iaa.arenaOverall.byVerdict.b_better}
              </span>
            </div>
          </section>
        )}
      </>
    )
  }
  return null
}

function SimpleAgreementTable({
  rows,
}: {
  rows: Array<{
    key: string
    multi: number
    disputed: number
    rate: number | null
  }>
}) {
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
      }}
    >
      <table className="w-full ts-13">
        <thead>
          <tr
            style={{
              background: 'var(--panel2)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <th
              className="text-left px-4 py-2 mono ts-11"
              style={{ color: 'var(--mute)' }}
            >
              ID
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              SAMPLES
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              DISPUTED
            </th>
            <th
              className="px-4 py-2 mono ts-11 text-center"
              style={{ color: 'var(--mute)', width: 100 }}
            >
              AGREEMENT
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={r.key}
              style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--line)' }}
            >
              <td
                className="px-4 py-2 mono ts-12"
                style={{ color: 'var(--text)' }}
              >
                {r.key}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{ color: 'var(--mute)' }}
              >
                {r.multi}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{
                  color: r.disputed > 0 ? 'var(--danger)' : 'var(--mute)',
                }}
              >
                {r.disputed}
              </td>
              <td
                className="px-4 py-2 mono ts-12 text-center"
                style={{
                  color:
                    r.rate === null
                      ? 'var(--mute2)'
                      : r.rate >= 0.8
                        ? 'oklch(0.65 0.18 200)'
                        : r.rate >= 0.5
                          ? 'oklch(0.7 0.14 75)'
                          : 'var(--danger)',
                  fontWeight: 600,
                }}
              >
                {r.rate === null ? '—' : `${Math.round(r.rate * 100)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyIaaCard({ kind }: { kind: 'rubric' | 'dimension' }) {
  return (
    <div
      className="rounded-md px-4 py-6 text-center ts-13"
      style={{
        background: 'var(--panel)',
        border: '1px dashed var(--line)',
        color: 'var(--mute2)',
      }}
    >
      No {kind} agreement data yet — at least two annotators must submit
      on the same topic.
    </div>
  )
}
