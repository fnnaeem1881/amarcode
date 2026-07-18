import { useState } from "react";
import type { Plan } from "@amarcode/shared";

type Tab = "terminal" | "problems" | "git" | "output" | "memory" | "plan";

export function BottomPanel({
  terminal, output, git, problems, memory, plan,
}: {
  terminal: string;
  output: string;
  git: string;
  problems: string[];
  memory: any;
  plan: Plan | null;
}) {
  const [tab, setTab] = useState<Tab>("terminal");
  const tabs: Tab[] = ["terminal", "problems", "git", "output", "memory", "plan"];

  return (
    <div className="bottom">
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}{t === "problems" && problems.length ? ` (${problems.length})` : ""}
          </div>
        ))}
      </div>

      {tab === "terminal" && <div className="tab-body terminal">{terminal || "$ terminal output will appear here"}</div>}
      {tab === "output" && <div className="tab-body terminal">{output || "Engine output…"}</div>}
      {tab === "git" && <div className="tab-body terminal">{git || "Run a git tool to see status/diff here."}</div>}
      {tab === "problems" && (
        <div className="tab-body">
          {problems.length ? problems.map((p, i) => <div key={i} style={{ color: "var(--red)" }}>● {p}</div>) : <span className="hint">No problems detected.</span>}
        </div>
      )}
      {tab === "memory" && (
        <div className="tab-body">
          {memory ? (
            <>
              {memory.codingStyle && <div><b>Coding style:</b> {memory.codingStyle}</div>}
              {memory.frameworkVersion && <div><b>Framework version:</b> {memory.frameworkVersion}</div>}
              {!!memory.architectureDecisions?.length && <div style={{ marginTop: 6 }}><b>Architecture decisions:</b>{memory.architectureDecisions.map((d: string, i: number) => <div key={i}>• {d}</div>)}</div>}
              {!!memory.userPreferences?.length && <div style={{ marginTop: 6 }}><b>Preferences:</b>{memory.userPreferences.map((d: string, i: number) => <div key={i}>• {d}</div>)}</div>}
            </>
          ) : <span className="hint">No project memory yet.</span>}
        </div>
      )}
      {tab === "plan" && (
        <div className="tab-body" style={{ fontFamily: "var(--font)" }}>
          {plan ? (
            <>
              <div style={{ marginBottom: 8, color: "var(--text-dim)" }}>{plan.summary}</div>
              {plan.steps.map((s) => (
                <div key={s.id} className="plan-step">
                  <span className={`action ${s.action}`}>{s.action}</span>
                  <span style={{ fontWeight: 600 }}>{s.target}</span>
                  <span className="hint">— {s.reason}</span>
                </div>
              ))}
            </>
          ) : <span className="hint">Ask the assistant to plan a task to see steps here.</span>}
        </div>
      )}
    </div>
  );
}
