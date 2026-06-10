import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { optionalUser, requireWorkspaceAdmin } from "@/lib/auth/guards";
import { getWorkspaceById } from "@/lib/queries/workspaces";
import { getTemplate } from "@/lib/templates/registry";
import "@/lib/templates/init";
import type { TemplateMode } from "@/lib/templates/types";
import { CreateTaskForm } from "@/components/task-admin/create-task-form";
import { listCustomFormSchemas } from "@/lib/form-designer/storage";

export const metadata: Metadata = {
  title: "New task — LabelHub",
};

export const dynamic = "force-dynamic";

/**
 * /workspaces/[id]/tasks/new — admin-only task creation flow.
 *
 * The form lets the admin name the task, pick reward config, and (for
 * pair-rubric / arena-gsb) tweak the rubric/dimension list. After
 * submit we redirect to the task detail page where they can add topics.
 *
 * templateMode is inherited from the workspace — annotators within a
 * workspace work on a single paradigm at a time.
 */
export default async function NewTaskPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id: workspaceId } = await props.params;

  const me = await optionalUser();
  if (!me) {
    redirect(`/signin?next=/workspaces/${workspaceId}/tasks/new`);
  }
  try {
    await requireWorkspaceAdmin(workspaceId);
  } catch {
    notFound();
  }

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) notFound();

  const template = getTemplate(workspace.templateMode as TemplateMode);
  if (!template) {
    throw new Error(
      `Workspace uses unregistered template "${workspace.templateMode}".`,
    );
  }

  const customFormSchemas =
    template.mode === "custom-designer"
      ? await listCustomFormSchemas({ workspaceId })
      : [];

  return (
    <div className="max-w-[900px] mx-auto px-6 py-8">
      <CreateTaskForm
        workspaceId={workspaceId}
        workspaceName={workspace.name}
        templateMode={template.mode}
        templateName={template.name}
        templateDescription={template.description}
        defaultPairChecklist={template.pairChecklist ?? null}
        defaultArenaDimensions={template.arenaDimensions ?? null}
        defaultTrajectoryRubric={template.rubric ?? null}
        customFormSchemas={customFormSchemas}
      />
    </div>
  );
}
