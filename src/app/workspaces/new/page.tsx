import type { Metadata } from 'next'
import {
  TemplatePicker,
  type PickerTemplate,
} from '@/components/workspaces/template-picker'
import { listTemplates } from '@/lib/templates/registry'
import '@/lib/templates/init' // side-effect: registers all 6 modes

export const metadata: Metadata = {
  title: 'Start a workspace — LabelHub',
}

export default function NewWorkspacePage() {
  const templates: PickerTemplate[] = listTemplates().map((t) => ({
    mode: t.mode,
    name: t.name,
    description: t.description,
  }))
  return <TemplatePicker templates={templates} />
}
