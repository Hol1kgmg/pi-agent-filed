import type { ToolExecutionResult } from "@earendil-works/pi-durable";

/** Preserve the command's result, but never report persistence before the container saves it. */
export async function checkpointToolResult(
  name: string,
  result: ToolExecutionResult,
  save: () => Promise<boolean>,
): Promise<ToolExecutionResult> {
  if (!["bash", "write", "edit"].includes(name)) return result;
  try {
    // A restart can settle an interrupted call before its container is started again.
    if (!(await save())) return result;
  } catch (error) {
    console.error("sandbox_checkpoint_failed", String(error));
    return {
      ...result,
      isError: true,
      control: { ...result.control, terminate: true },
      diagnostics: [
        ...(result.diagnostics ?? []),
        {
          severity: "error",
          code: "workspace_checkpoint_failed",
          message: `Workspace checkpoint failed (${String(error)}). Work may not survive a restart. Do not repeat the command.`,
        },
      ],
    };
  }
  return {
    ...result,
    diagnostics: [
      ...(result.diagnostics ?? []),
      {
        severity: "info",
        code: "workspace_saved",
        message: "Workspace checkpoint saved.",
      },
    ],
  };
}
