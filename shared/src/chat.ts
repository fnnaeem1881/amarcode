/** Chat, planning and memory contracts. */

import type { ToolCall } from "./providers.js";

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  projectRoot: string;
  title: string;
  /** Per-chat model override, if any. */
  providerId?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanStep {
  id: string;
  action: "create" | "modify" | "update" | "delete" | "run" | "review";
  target: string;
  reason: string;
  status: "pending" | "in_progress" | "done" | "skipped" | "failed";
}

export interface Plan {
  id: string;
  sessionId: string;
  summary: string;
  steps: PlanStep[];
  createdAt: string;
}

export interface ProjectMemory {
  projectRoot: string;
  codingStyle?: string;
  architectureDecisions: string[];
  userPreferences: string[];
  frameworkVersion?: string;
  databaseType?: string;
  updatedAt: string;
}

export interface CostRecord {
  id: string;
  projectRoot?: string;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCost: number;
  createdAt: string;
}
