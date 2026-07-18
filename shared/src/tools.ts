/** Tool-execution contracts shared between the tool engine and the UI. */

export interface ToolResult {
  ok: boolean;
  /** Human/LLM-readable output. */
  output: string;
  /** Optional structured payload for the UI (e.g. a diff, a file listing). */
  data?: unknown;
  error?: string;
}

/** Level of confirmation a tool call requires before execution. */
export type ToolRisk = "safe" | "confirm" | "dangerous";

export interface ToolDescriptor {
  name: string;
  description: string;
  risk: ToolRisk;
  parameters: Record<string, unknown>;
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  /** Unified diff text for display. */
  unified: string;
}
