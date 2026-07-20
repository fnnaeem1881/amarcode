/** WebSocket client for streaming agent chat + approvals. */

export interface AgentStreamHandlers {
  onText?: (delta: string) => void;
  onToolStart?: (call: { id: string; name: string; arguments: any }) => void;
  onToolResult?: (call: any, result: any) => void;
  onToolEvent?: (event: { type: string; payload: any }) => void;
  onApproval?: (req: { id: string; action: string; risk: string; detail?: string }) => void;
  onIteration?: (n: number) => void;
  onUsage?: (u: { inputTokens: number; outputTokens: number; totalTokens: number }) => void;
  onDone?: (text: string) => void;
  onError?: (message: string) => void;
}

export class AgentSocket {
  private ws: WebSocket | null = null;
  private handlers: AgentStreamHandlers = {};

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("WebSocket failed"));
      this.ws.onmessage = (ev) => this.dispatch(JSON.parse(ev.data));
    });
  }

  private dispatch(e: any): void {
    const h = this.handlers;
    switch (e.type) {
      case "text": h.onText?.(e.delta); break;
      case "tool_start": h.onToolStart?.(e.call); break;
      case "tool_result": h.onToolResult?.(e.call, e.result); break;
      case "tool_event": h.onToolEvent?.(e.event); break;
      case "approval_request": h.onApproval?.(e); break;
      case "iteration": h.onIteration?.(e.n); break;
      case "usage": h.onUsage?.({ inputTokens: e.inputTokens, outputTokens: e.outputTokens, totalTokens: e.totalTokens }); break;
      case "done": h.onDone?.(e.text); break;
      case "error": h.onError?.(e.message); break;
    }
  }

  chat(payload: { sessionId?: string; root: string; task: string; override?: { providerId: string; model: string }; previewUrl?: string; lite?: boolean; images?: string[] }, handlers: AgentStreamHandlers): void {
    this.handlers = handlers;
    this.ws?.send(JSON.stringify({ type: "chat", ...payload }));
  }

  approve(id: string, approved: boolean): void {
    this.ws?.send(JSON.stringify({ type: "approval", id, approved }));
  }

  cancel(): void {
    this.ws?.send(JSON.stringify({ type: "cancel" }));
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
