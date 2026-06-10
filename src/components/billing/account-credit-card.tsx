'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { adminCreditAccount } from '@/lib/actions/billing/admin-credit'

/**
 * Admin "credit an account" card (operable payment loop, step 1).
 *
 * The admin picks a workspace member, enters an amount in major units, and
 * the wallet is credited via a positive `adjustment` ledger row. The user
 * sees the new balance on /my/earnings immediately.
 */
type Member = {
  userId: string
  email: string | null
  displayName: string | null
  role: string
}

export function AccountCreditCard({
  workspaceId,
  members,
}: {
  workspaceId: string
  members: Member[]
}) {
  const router = useRouter()
  const [userId, setUserId] = useState(members[0]?.userId ?? '')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [memo, setMemo] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(
    null,
  )
  // Client-side confirm gate: a credit is irreversible, so a typo
  // (1000 vs 100) shouldn't go straight through. `confirming` holds the
  // already-validated amount/label until the admin confirms or cancels.
  const [confirming, setConfirming] = useState<{
    amountMinor: number
    cur: string
    memberLabel: string
    amountLabel: string
  } | null>(null)
  const [pending, start] = useTransition()

  // Validate inputs and stage a confirmation step. The actual action
  // call is deferred to runCredit() so a mistyped amount can be caught.
  function requestConfirm() {
    setMsg(null)
    const major = Number(amount)
    if (!userId) {
      setMsg({ kind: 'err', text: 'Pick an account to credit.' })
      return
    }
    if (!Number.isFinite(major) || major <= 0) {
      setMsg({ kind: 'err', text: 'Enter a positive amount.' })
      return
    }
    const amountMinor = Math.round(major * 100)
    const cur = currency.trim() || 'CNY'
    const member = members.find((m) => m.userId === userId)
    const memberLabel =
      member?.displayName || member?.email || userId.slice(0, 8)
    setConfirming({
      amountMinor,
      cur,
      memberLabel,
      amountLabel: (amountMinor / 100).toFixed(2),
    })
  }

  // Run the credit for the staged confirmation. Action call is unchanged.
  function runCredit() {
    if (!confirming) return
    const { amountMinor, cur } = confirming
    setConfirming(null)
    start(async () => {
      try {
        const res = await adminCreditAccount({
          workspaceId,
          userId,
          amountMinor,
          currency: cur,
          memo: memo.trim() || undefined,
        })
        setMsg({
          kind: 'ok',
          text: `Credited. New balance: ${(res.newBalanceMinor / 100).toFixed(2)} ${cur}.`,
        })
        setAmount('')
        setMemo('')
        router.refresh()
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
      }
    })
  }

  const inputStyle = {
    padding: '6px 10px',
    border: '1px solid var(--line)',
    borderRadius: 6,
    background: 'var(--panel2)',
    color: 'var(--text)',
    outline: 'none',
  } as const

  return (
    <section
      className="rounded-xl p-4"
      style={{ border: '1px solid var(--line)', background: 'var(--panel)' }}
    >
      <div className="lbl mb-1">§ CREDIT AN ACCOUNT</div>
      <p className="ts-13 mb-3" style={{ color: 'var(--mute)' }}>
        Set a withdrawable balance for a workspace member. Lands as a ledger
        adjustment; the member sees it instantly on their earnings page.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            ACCOUNT
          </span>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="ts-13"
            style={{ ...inputStyle, minWidth: 220 }}
          >
            {members.length === 0 && <option value="">(no members)</option>}
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName || m.email || m.userId.slice(0, 8)} · {m.role}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            AMOUNT
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="50.00"
            className="ts-13 mono"
            style={{ ...inputStyle, width: 110 }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            CURRENCY
          </span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            maxLength={8}
            className="ts-13 mono"
            style={{ ...inputStyle, width: 80 }}
          />
        </label>
        <label className="flex flex-col gap-1 flex-1" style={{ minWidth: 160 }}>
          <span className="ts-12 mono" style={{ color: 'var(--mute2)' }}>
            MEMO (optional)
          </span>
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={200}
            placeholder="e.g. milestone bonus"
            className="ts-13"
            style={inputStyle}
          />
        </label>
        <button
          type="button"
          disabled={pending || confirming !== null}
          onClick={requestConfirm}
          className="ts-13 mono"
          style={{
            padding: '7px 16px',
            border: '1px solid var(--accent-line)',
            borderRadius: 6,
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            cursor: pending ? 'wait' : 'pointer',
            fontWeight: 600,
            opacity: pending || confirming !== null ? 0.6 : 1,
          }}
        >
          {pending ? 'crediting…' : 'Credit'}
        </button>
      </div>
      {confirming && (
        <div
          className="mt-3 flex flex-wrap items-center gap-3 rounded-lg p-3"
          style={{
            border: '1px solid var(--warn)',
            background: 'var(--warn-soft, var(--panel2))',
          }}
        >
          <span className="ts-13" style={{ color: 'var(--text)' }}>
            Credit <strong>{confirming.memberLabel}</strong>{' '}
            <strong className="mono">
              {confirming.amountLabel} {confirming.cur}
            </strong>
            ? This cannot be undone.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="ts-12 mono"
              style={{
                padding: '6px 14px',
                border: '1px solid var(--line)',
                borderRadius: 6,
                background: 'var(--panel)',
                color: 'var(--mute)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={runCredit}
              className="ts-12 mono"
              style={{
                padding: '6px 14px',
                border: '1px solid var(--warn)',
                borderRadius: 6,
                background: 'var(--warn)',
                color: 'white',
                cursor: pending ? 'wait' : 'pointer',
                fontWeight: 600,
                opacity: pending ? 0.6 : 1,
              }}
            >
              Confirm credit
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p
          className="ts-12 mt-3"
          style={{ color: msg.kind === 'ok' ? 'var(--success)' : 'var(--danger)' }}
        >
          {msg.text}
        </p>
      )}
    </section>
  )
}
