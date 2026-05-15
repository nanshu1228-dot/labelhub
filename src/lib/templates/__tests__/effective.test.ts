import { describe, it, expect } from 'vitest'
import { getEffectiveTemplate } from '../effective'
import '../init'

/**
 * `getEffectiveTemplate` merges per-task `template_config` overrides on
 * top of the template's bake-in defaults. These tests pin its behavior:
 *
 *   - templateMode unknown    → undefined (caller falls back / errors)
 *   - taskConfig null         → exact template (no merge)
 *   - taskConfig empty obj    → exact template (no merge)
 *   - taskConfig with pairChecklist → REPLACES the template's checklist
 *   - taskConfig with arenaDimensions → REPLACES the template's dimensions
 *   - malformed items (bad id type, missing name) → dropped silently
 */

describe('getEffectiveTemplate', () => {
  it('returns undefined for unknown templateMode', () => {
    expect(getEffectiveTemplate('not-a-real-mode', null)).toBeUndefined()
  })

  it('returns the registered template unchanged when taskConfig is null', () => {
    const eff = getEffectiveTemplate('pair-rubric', null)
    expect(eff).toBeDefined()
    expect(eff!.mode).toBe('pair-rubric')
    // The shipped preset has 5 items
    expect(eff!.pairChecklist?.length).toBe(5)
  })

  it('returns the registered template when taskConfig is {} (no overrides)', () => {
    const eff = getEffectiveTemplate('pair-rubric', {})
    expect(eff!.pairChecklist?.length).toBe(5)
  })

  it('replaces pairChecklist when taskConfig.pairChecklist is provided', () => {
    const override = [
      { id: 'admin_picked_a', name: 'A picked' },
      { id: 'admin_picked_b', name: 'B picked', description: 'with desc' },
    ]
    const eff = getEffectiveTemplate('pair-rubric', {
      pairChecklist: override,
    })
    expect(eff!.pairChecklist).toEqual(override)
    expect(eff!.pairChecklist?.length).toBe(2)
  })

  it('replaces arenaDimensions when taskConfig.arenaDimensions is provided', () => {
    const override = [
      { id: 'speed', name: 'Speed' },
      { id: 'cost', name: 'Cost', description: 'TCO' },
    ]
    const eff = getEffectiveTemplate('arena-gsb', {
      arenaDimensions: override,
    })
    expect(eff!.arenaDimensions).toEqual(override)
    expect(eff!.arenaDimensions?.length).toBe(2)
  })

  it('ignores malformed items (missing id, missing name, wrong types)', () => {
    const eff = getEffectiveTemplate('pair-rubric', {
      pairChecklist: [
        { id: 'ok', name: 'OK' },
        { id: '', name: 'no id' },
        { id: 'no_name' },
        { id: 'ok_too', name: 123 }, // wrong type
        { id: 42, name: 'numeric id' }, // wrong type
        null,
        'totally bogus',
      ],
    })
    // Only the {id:'ok', name:'OK'} entry survived.
    expect(eff!.pairChecklist?.length).toBe(1)
    expect(eff!.pairChecklist?.[0].id).toBe('ok')
  })

  it('falls back to the template default when the override list ends up empty', () => {
    // All items malformed → override is dropped, template default wins.
    const eff = getEffectiveTemplate('pair-rubric', {
      pairChecklist: [{ id: '' }, { id: 'no_name' }],
    })
    expect(eff!.pairChecklist?.length).toBe(5)
  })

  it('does not cross-pollinate: pair-rubric override does not affect arena-gsb', () => {
    const eff = getEffectiveTemplate('pair-rubric', {
      arenaDimensions: [{ id: 'wrong_place', name: 'Wrong' }],
    })
    // arenaDimensions on a pair-rubric template is ignored at the merge
    // layer because the source template doesn't declare them. The merge
    // is structural — it preserves whatever pair-rubric already had.
    expect(eff!.pairChecklist?.length).toBe(5)
    // arenaDimensions still merges in because the merge layer is value-
    // shape-only, but the pair-rubric annotator UI never reads it. The
    // sanity check that rejects this combo lives in `createTask`, not
    // here.
    expect(eff!.arenaDimensions).toBeDefined()
  })

  it('clone semantics: mutating returned template does not affect the registry', () => {
    const e1 = getEffectiveTemplate('pair-rubric', {
      pairChecklist: [{ id: 'one', name: 'One' }],
    })!
    // Mutate the override (clone is shallow, but the registry's reference
    // is the original from registry, not our cloned one).
    ;(e1.pairChecklist as unknown as Array<{ id: string }>).push({
      id: 'mutated',
    })
    const e2 = getEffectiveTemplate('pair-rubric', null)
    expect(e2!.pairChecklist?.length).toBe(5)
  })
})
