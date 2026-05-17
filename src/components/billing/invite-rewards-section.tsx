import type { MyInviteRewardRow } from '@/lib/queries/invite-rewards'

/**
 * Invite-reward list on /my/earnings (Phase-13).
 *
 * Server-rendered (parent calls listMyInviteRewards). Read-only — the
 * annotator can't trigger anything from here; this is just a record of
 * what they've earned via referrals.
 */
export function InviteRewardsSection({
  rows,
}: {
  rows: MyInviteRewardRow[]
}) {
  if (rows.length === 0) {
    return (
      <section>
        <div className="mb-3">
          <div className="lbl mb-1">§ INVITE REWARDS</div>
          <h2 className="ts-22" style={{ color: 'var(--hi)' }}>
            People you brought in
          </h2>
        </div>
        <div
          className="rounded-md px-4 py-6 text-center ts-13"
          style={{
            background: 'var(--panel)',
            border: '1px dashed var(--line)',
            color: 'var(--mute2)',
          }}
        >
          No invite rewards yet. When someone you invited completes 5
          approved annotations in a workspace, you earn ¥200.
        </div>
      </section>
    )
  }

  // Aggregate totals so the section header doubles as a "you earned X
  // from referrals" callout.
  const totalsByCurrency = new Map<string, number>()
  let grantedCount = 0
  let pendingCount = 0
  let blockedCount = 0
  for (const r of rows) {
    if (r.status === 'granted') {
      grantedCount += 1
      totalsByCurrency.set(
        r.currency,
        (totalsByCurrency.get(r.currency) ?? 0) + r.amountMinor,
      )
    } else if (r.status === 'manual_review') {
      pendingCount += 1
    } else if (r.status === 'blocked') {
      blockedCount += 1
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="lbl mb-1">§ INVITE REWARDS</div>
          <h2 className="ts-22" style={{ color: 'var(--hi)' }}>
            People you brought in
          </h2>
        </div>
        <div
          className="ts-13 mono flex items-center gap-3"
          style={{ color: 'var(--mute)' }}
        >
          {Array.from(totalsByCurrency.entries()).map(([cur, amt]) => (
            <span key={cur}>
              earned{' '}
              <strong
                className="ts-15"
                style={{ color: 'var(--success)' }}
              >
                {cur} {(amt / 100).toFixed(2)}
              </strong>
            </span>
          ))}
          <span>
            · {grantedCount} granted · {pendingCount} pending · {blockedCount}{' '}
            blocked
          </span>
        </div>
      </div>

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
                INVITEE
              </th>
              <th
                className="text-left px-4 py-2 mono ts-11"
                style={{ color: 'var(--mute)' }}
              >
                STATUS
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-right"
                style={{ color: 'var(--mute)', width: 110 }}
              >
                AMOUNT
              </th>
              <th
                className="px-4 py-2 mono ts-11 text-left"
                style={{ color: 'var(--mute)' }}
              >
                WHEN
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <td
                  className="px-4 py-2 ts-13"
                  style={{ color: 'var(--text)' }}
                >
                  {r.inviteeDisplayName ?? (
                    <span
                      className="mono ts-12"
                      style={{ color: 'var(--mute2)' }}
                    >
                      {r.inviteeEmail
                        ? r.inviteeEmail.split('@')[0]
                        : r.id.slice(0, 8)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 ts-12">
                  <StatusChip status={r.status} reason={r.blockReason} />
                </td>
                <td
                  className="px-4 py-2 mono ts-13 text-right"
                  style={{
                    color:
                      r.status === 'granted'
                        ? 'var(--success)'
                        : 'var(--mute)',
                    fontWeight: r.status === 'granted' ? 600 : 400,
                  }}
                >
                  {r.currency} {(r.amountMinor / 100).toFixed(2)}
                </td>
                <td
                  className="px-4 py-2 mono ts-11"
                  style={{ color: 'var(--mute2)' }}
                >
                  {(r.grantedAt ?? r.createdAt)
                    .toISOString()
                    .slice(0, 16)
                    .replace('T', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StatusChip({
  status,
  reason,
}: {
  status: string
  reason: string | null
}) {
  const palette =
    status === 'granted'
      ? {
          fg: 'var(--success)',
          bg: 'oklch(0.65 0.18 200 / 0.1)',
          line: 'oklch(0.65 0.18 200 / 0.35)',
        }
      : status === 'manual_review'
        ? {
            fg: 'oklch(0.55 0.14 75)',
            bg: 'oklch(0.6 0.14 75 / 0.1)',
            line: 'oklch(0.6 0.14 75 / 0.4)',
          }
        : status === 'blocked'
          ? {
              fg: 'var(--danger)',
              bg: 'oklch(0.55 0.2 25 / 0.1)',
              line: 'oklch(0.55 0.2 25 / 0.35)',
            }
          : {
              fg: 'var(--mute)',
              bg: 'var(--panel2)',
              line: 'var(--line)',
            }
  return (
    <span
      className="mono ts-11 px-2 py-0.5 rounded inline-block"
      style={{
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.line}`,
      }}
      title={reason ?? undefined}
    >
      {status}
    </span>
  )
}
