import { nextTopicInTask } from '@/lib/actions/next-topic'

/** Minimal structural slice of next/navigation's router we need. */
type NavRouter = { push: (href: string) => void; refresh: () => void }

/**
 * After a successful submit, advance the labeler straight into the next
 * workable topic in the same task (keeps them in flow). Falls back to the
 * task page when there's no next topic OR if the lookup errors — so the
 * core submit path is never made worse by this convenience.
 */
export async function navigateAfterSubmit(
  router: NavRouter,
  opts: { taskId: string; topicId: string },
): Promise<void> {
  // NOTE: no router.refresh() after push. refresh() cancels an
  // in-flight push navigation (the RSC fetch aborts with ERR_ABORTED),
  // which on a high-latency deploy left the submit button stuck on
  // "Submitting…" forever — caught by doctor --deep against prod.
  // Dynamic routes refetch on push anyway (router-cache staleTime 0),
  // so the refresh was redundant.
  try {
    const next = await nextTopicInTask({
      taskId: opts.taskId,
      excludeTopicId: opts.topicId,
    })
    if (next) {
      // `?submitted=1` lets the next topic's page show a "上一题已提交"
      // banner — without it, auto-advance reads as "my work vanished".
      router.push(
        `/workspaces/${next.workspaceId}/topics/${next.topicId}/annotate?submitted=1`,
      )
      return
    }
  } catch {
    // Non-fatal — fall through to the task page.
  }
  router.push(`/my/tasks/${opts.taskId}`)
}
