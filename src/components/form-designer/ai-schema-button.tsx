'use client'

import { useState, useTransition } from 'react'
import { Sparkles } from 'lucide-react'
import { generateFormSchemaFromDescription } from '@/lib/actions/generate-form-schema'
import { getErrorMessage } from '@/lib/errors/client-utils'
import type { FormSchema } from '@/lib/form-designer/schema'

/**
 * "✨ AI design" — admin describes the annotation form in words; Claude
 * scaffolds a starting FormSchema into the canvas. Reviewed + saved
 * separately, so this only seeds the canvas (no writes here).
 */
export function AiSchemaButton({
  workspaceId,
  onSchema,
}: {
  workspaceId: string
  onSchema: (schema: FormSchema, summary: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [desc, setDesc] = useState('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function generate() {
    setError(null)
    const d = desc.trim()
    if (d.length < 8) {
      setError('多写几句任务描述(≥ 8 字)。')
      return
    }
    start(async () => {
      try {
        const res = await generateFormSchemaFromDescription({
          workspaceId,
          description: d,
        })
        onSchema(res.schema, res.summary)
        setOpen(false)
      } catch (e) {
        setError(getErrorMessage(e, 'AI 生成失败,请重试。'))
      }
    })
  }

  return (
    <div
      className="mb-5 flex flex-col gap-2 rounded-md p-3"
      style={{ background: 'var(--bg)', border: '1px solid var(--accent-line)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
        style={{
          minHeight: 32,
          background: 'var(--accent)',
          color: 'white',
          border: '1px solid var(--accent)',
          cursor: 'pointer',
        }}
        aria-expanded={open}
      >
        <Sparkles size={13} />
        AI 设计表单
      </button>

      {open ? (
        <>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={4}
            placeholder="一句话描述要标注什么。例如:展示用户问题和模型回答,按相关性/准确性 1-5 打分,再写一句总评和问题标签。"
            className="ts-12"
            style={{
              width: '100%',
              background: 'var(--panel2)',
              border: '1px solid var(--line)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '8px 10px',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          {error ? (
            <div className="ts-11" style={{ color: 'var(--danger)' }}>
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={generate}
            disabled={pending}
            className="ts-12 mono inline-flex items-center justify-center gap-1.5 rounded px-3"
            style={{
              minHeight: 30,
              background: pending ? 'var(--panel2)' : 'var(--hi)',
              color: pending ? 'var(--mute2)' : 'var(--bg)',
              border: '1px solid var(--line)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {pending ? '生成中…' : '生成表单'}
          </button>
          <div className="ts-11" style={{ color: 'var(--mute2)' }}>
            生成后会载入画布,保存前可自由增删改(可撤销)。
          </div>
        </>
      ) : null}
    </div>
  )
}
