import {
  useState,
  useTransition,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { PairChecklistItem, TemplateMode } from "@/lib/templates/types";
import type { RubricItem, RubricSpec } from "@/lib/templates/rubric";
import {
  generateTemplateFromDescription,
  generateTrajectoryRubricFromDescription,
} from "@/lib/actions/template-generator";
import {
  nextKey,
  toEditable,
  toEditableRubric,
  type EditableItem,
  type EditableRubricItem,
} from "./create-task-form-helpers";
import { getErrorMessage } from "@/lib/errors/client-utils";

/**
 * State + handlers for the task-creation form, extracted from the orchestrator
 * (CreateTaskForm) into co-located hooks so that 1.9k-line component stays a
 * focused form shell. These are PURE BEHAVIOR-PRESERVING relocations — the
 * useState declarations and handler bodies are unchanged; they just live here
 * and are returned to the orchestrator, which destructures and uses them
 * exactly as before.
 *
 * Three clusters:
 *   - useRubricEditor          : pair-rubric / arena-gsb flat item list
 *   - useTrajectoryRubricEditor: agent-trace-eval perStep + perTrajectory lists
 *   - useRubricGenerator       : the 🪄 NL→rubric modal; its generate handler
 *                                writes INTO the two editors above, so it takes
 *                                their setters as inputs (the same coupling the
 *                                inline version had).
 */

export function useRubricEditor(opts: {
  templateMode: TemplateMode;
  defaultPairChecklist: readonly PairChecklistItem[] | null;
  defaultArenaDimensions: readonly PairChecklistItem[] | null;
}) {
  const initialChecklist =
    opts.templateMode === "pair-rubric"
      ? (opts.defaultPairChecklist ?? [])
      : opts.templateMode === "arena-gsb"
        ? (opts.defaultArenaDimensions ?? [])
        : [];
  const [items, setItems] = useState<EditableItem[]>(() =>
    toEditable(initialChecklist),
  );

  function setItem(key: string, patch: Partial<PairChecklistItem>) {
    setItems((prev) =>
      prev.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it._key !== key));
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      { _key: nextKey(), id: "", name: "", description: "" },
    ]);
  }
  function restoreDefaults() {
    setItems(toEditable(initialChecklist));
  }

  return {
    items,
    setItems,
    setItem,
    removeItem,
    addItem,
    restoreDefaults,
    initialChecklist,
  };
}

export function useTrajectoryRubricEditor(opts: {
  defaultTrajectoryRubric: RubricSpec | null;
}) {
  const initialTrajRubric = opts.defaultTrajectoryRubric ?? {
    perStep: [],
    perTrajectory: [],
  };
  const [trajPerStep, setTrajPerStep] = useState<EditableRubricItem[]>(() =>
    toEditableRubric(initialTrajRubric.perStep),
  );
  const [trajPerTraj, setTrajPerTraj] = useState<EditableRubricItem[]>(() =>
    toEditableRubric(initialTrajRubric.perTrajectory),
  );

  function setTrajItem(
    list: "perStep" | "perTrajectory",
    key: string,
    patch: Partial<RubricItem>,
  ) {
    const setter = list === "perStep" ? setTrajPerStep : setTrajPerTraj;
    setter((prev) =>
      prev.map((it) => (it._key === key ? { ...it, ...patch } : it)),
    );
  }
  function removeTrajItem(list: "perStep" | "perTrajectory", key: string) {
    const setter = list === "perStep" ? setTrajPerStep : setTrajPerTraj;
    setter((prev) => prev.filter((it) => it._key !== key));
  }
  function restoreTrajDefaults() {
    setTrajPerStep(toEditableRubric(initialTrajRubric.perStep));
    setTrajPerTraj(toEditableRubric(initialTrajRubric.perTrajectory));
  }

  return {
    trajPerStep,
    trajPerTraj,
    setTrajPerStep,
    setTrajPerTraj,
    setTrajItem,
    removeTrajItem,
    restoreTrajDefaults,
    initialTrajRubric,
  };
}

export function useRubricGenerator(opts: {
  workspaceId: string;
  templateMode: TemplateMode;
  supportsRubricEditor: boolean;
  supportsTrajectoryEditor: boolean;
  setItems: Dispatch<SetStateAction<EditableItem[]>>;
  setTrajPerStep: Dispatch<SetStateAction<EditableRubricItem[]>>;
  setTrajPerTraj: Dispatch<SetStateAction<EditableRubricItem[]>>;
}) {
  const {
    workspaceId,
    templateMode,
    supportsRubricEditor,
    supportsTrajectoryEditor,
    setItems,
    setTrajPerStep,
    setTrajPerTraj,
  } = opts;

  const [genOpen, setGenOpen] = useState(false);
  const [genDescription, setGenDescription] = useState("");
  const [genPending, startGenTransition] = useTransition();
  const [genError, setGenError] = useState<string | null>(null);
  const [genSummary, setGenSummary] = useState<string | null>(null);

  /**
   * Call the NL → rubric server action with the modal's description and
   * REPLACE the current rubric items with the result. The admin then
   * reviews each row + can edit names/descriptions before saving.
   *
   * We don't append — we replace. If the admin wanted to keep their
   * existing rows, they'd close the modal without generating.
   *
   * Two dispatch paths:
   *   - pair-rubric / arena-gsb → flat list, fills `items`
   *   - agent-trace-eval        → RubricSpec, fills both trajectory lists
   */
  function generateFromDescription() {
    const desc = genDescription.trim();
    if (desc.length < 8) {
      setGenError("Describe the task in a sentence or two (≥ 8 chars).");
      return;
    }
    setGenError(null);
    setGenSummary(null);
    if (supportsRubricEditor) {
      startGenTransition(async () => {
        try {
          const r = await generateTemplateFromDescription({
            workspaceId,
            mode: templateMode as "pair-rubric" | "arena-gsb",
            description: desc,
          });
          setItems(
            r.template.items.map((i) => ({
              _key: nextKey(),
              id: i.id,
              name: i.name,
              description: i.description,
              showWhen: i.showWhen,
            })),
          );
          setGenSummary(r.template.summary);
        } catch (e) {
          setGenError(getErrorMessage(e, "Generation failed."));
        }
      });
      return;
    }
    if (supportsTrajectoryEditor) {
      startGenTransition(async () => {
        try {
          const r = await generateTrajectoryRubricFromDescription({
            workspaceId,
            description: desc,
          });
          setTrajPerStep(toEditableRubric(r.rubric.perStep));
          setTrajPerTraj(toEditableRubric(r.rubric.perTrajectory));
          setGenSummary(r.generated.summary);
        } catch (e) {
          setGenError(getErrorMessage(e, "Generation failed."));
        }
      });
    }
  }

  return {
    genOpen,
    setGenOpen,
    genDescription,
    setGenDescription,
    genPending,
    genError,
    setGenError,
    genSummary,
    setGenSummary,
    generateFromDescription,
  };
}
