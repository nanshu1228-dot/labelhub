import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * updateTask — admin edits a task's base info after creation (name,
 * description, guidelines, payout, deadline, operational settings).
 *
 * Pins:
 *   - only fields that actually changed are written (no-op → no event);
 *   - the column patch + its `task.updated` audit event commit inside ONE
 *     db.transaction (no edit without its trail);
 *   - taskSettings replaces the stored settings while PRESERVING the
 *     paradigm config keys (rubric/checklist) alongside it;
 *   - archived tasks are refused; a missing task is NotFound.
 */

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({
  requireWorkspaceAdmin: vi.fn(async () => ({
    user: { id: "admin-1", email: "admin@example.com" },
    workspace: { id: "ws-1", templateMode: "qa_quality" },
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateTask } from "../tasks";
import { getDb } from "@/lib/db/client";
import { ConflictError, NotFoundError } from "@/lib/errors";

const WS = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";

const BASE_TASK = {
  id: TASK,
  workspaceId: WS,
  name: "Phase 1 · QA",
  description: "original desc",
  guidelinesMarkdown: "# Guidelines",
  templateMode: "qa_quality",
  rewardConfig: { type: "cash-per-item", currency: "CNY", baseAmountMinor: 1000 },
  templateConfig: {
    rubric: { perStep: [], perTrajectory: [] },
    taskSettings: { tags: ["old"], quotaTotal: 5, distributionStrategy: "open-queue" },
  },
  status: "open",
  deadline: null,
  phase: 1,
};

function mountDb(task: Record<string, unknown> | null) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const txUpdate = () => ({
    set: (vals: Record<string, unknown>) => {
      updates.push(vals);
      return { where: () => Promise.resolve(undefined) };
    },
  });
  const txInsert = () => ({
    values: (rows: Record<string, unknown>) => {
      inserts.push(rows);
      return Promise.resolve(undefined);
    },
  });
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({ update: txUpdate, insert: txInsert }),
  );
  vi.mocked(getDb).mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(task ? [task] : []) }),
      }),
    }),
    transaction,
  } as never);
  return { inserts, updates, transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateTask", () => {
  it("writes the changed field + a task.updated event inside one transaction", async () => {
    const { inserts, updates, transaction } = mountDb({ ...BASE_TASK });
    const res = await updateTask({ taskId: TASK, name: "Phase 1 · QA (renamed)" });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updates[0]?.name).toBe("Phase 1 · QA (renamed)");
    expect(inserts[0]?.type).toBe("task.updated");
    expect(
      (inserts[0]?.payload as { changedFields?: string[] })?.changedFields,
    ).toContain("name");
    expect(res).toBeTruthy();
  });

  it("is a no-op (no transaction, no event) when nothing actually changed", async () => {
    const { transaction } = mountDb({ ...BASE_TASK });
    const res = await updateTask({ taskId: TASK, name: BASE_TASK.name });
    expect(transaction).not.toHaveBeenCalled();
    expect((res as { id: string }).id).toBe(TASK);
  });

  it("merges taskSettings while preserving paradigm config keys (rubric)", async () => {
    const { updates } = mountDb({ ...BASE_TASK });
    await updateTask({
      taskId: TASK,
      taskSettings: {
        tags: ["new", "tags"],
        quotaTotal: null,
        distributionStrategy: "round-robin",
      },
    });
    const tc = updates[0]?.templateConfig as {
      rubric?: unknown;
      taskSettings?: { tags: string[]; quotaTotal: number | null; distributionStrategy: string };
    };
    // paradigm config preserved …
    expect(tc.rubric).toBeDefined();
    // … settings replaced wholesale (quota cleared to null)
    expect(tc.taskSettings?.tags).toEqual(["new", "tags"]);
    expect(tc.taskSettings?.quotaTotal).toBeNull();
    expect(tc.taskSettings?.distributionStrategy).toBe("round-robin");
  });

  it("refuses to edit an archived task", async () => {
    const { transaction } = mountDb({ ...BASE_TASK, status: "archived" });
    await expect(
      updateTask({ taskId: TASK, name: "nope" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("throws NotFound when the task does not exist", async () => {
    mountDb(null);
    await expect(
      updateTask({ taskId: TASK, name: "x" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
