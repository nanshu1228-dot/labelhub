import type { Material } from './types'

/**
 * File / image upload. D6 Renderer wires this to Supabase Storage via
 * the existing upload helpers. accept[] follows the input[type=file]
 * accept attribute convention.
 */
export const fileUploadFieldMaterial: Material = {
  kind: 'file-upload',
  name: 'File / image',
  icon: '⬆',
  defaultConfig: {
    accept: ['image/*'],
    maxSizeMb: 5,
    maxFiles: 1,
  },
  designerPreview: ({ field }) => {
    const cfg = field.config as {
      accept?: string[]
      maxSizeMb?: number
      maxFiles?: number
    }
    return (
      <div
        className="rounded p-4 text-center ts-13"
        style={{
          background: 'var(--bg)',
          border: '1px dashed var(--line)',
          color: 'var(--mute)',
          cursor: 'grab',
        }}
      >
        <div className="ts-22 mb-1">⬆</div>
        <div>Drop files or click to upload</div>
        <div
          className="ts-11 mono mt-1"
          style={{ color: 'var(--mute2)' }}
        >
          accept: {(cfg.accept ?? []).join(', ') || 'any'} · max
          {' '}
          {cfg.maxSizeMb ?? 5}MB
          {(cfg.maxFiles ?? 1) > 1 ? ` · up to ${cfg.maxFiles} files` : ''}
        </div>
      </div>
    )
  },
}
