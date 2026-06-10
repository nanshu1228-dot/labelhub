import { describe, expect, it } from 'vitest'
import {
  matchesAccept,
  normalizeUploadValue,
} from './file-upload-field'

describe('file-upload runtime helpers', () => {
  it('normalizes legacy URL strings and uploaded metadata objects', () => {
    expect(
      normalizeUploadValue([
        '/storage/labelhub-media/ws/a.png',
        {
          url: '/storage/labelhub-media/ws/b.pdf',
          path: 'ws/b.pdf',
          name: 'brief.pdf',
          size: 1234,
          type: 'application/pdf',
          uploadedAt: '2026-05-28T00:00:00.000Z',
        },
        null,
      ]),
    ).toEqual([
      {
        url: '/storage/labelhub-media/ws/a.png',
        path: '/storage/labelhub-media/ws/a.png',
        name: 'a.png',
        size: 0,
        type: '',
      },
      {
        url: '/storage/labelhub-media/ws/b.pdf',
        path: 'ws/b.pdf',
        name: 'brief.pdf',
        size: 1234,
        type: 'application/pdf',
        fieldId: undefined,
        uploadedAt: '2026-05-28T00:00:00.000Z',
      },
    ])
  })

  it('matches extension, exact mime, and wildcard accept tokens', () => {
    const png = new File(['x'], 'screen.PNG', { type: 'image/png' })
    const pdf = new File(['x'], 'brief.pdf', { type: 'application/pdf' })
    expect(matchesAccept(png, ['image/*'])).toBe(true)
    expect(matchesAccept(png, ['.png'])).toBe(true)
    expect(matchesAccept(pdf, ['application/pdf'])).toBe(true)
    expect(matchesAccept(pdf, ['image/*'])).toBe(false)
  })
})
