"use client";

import { useState, type RefObject } from "react";
import type { FlightLabAnimationEvent } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

type LogFilter = "all" | "clip" | "pin" | "scan" | "rig" | "compare";

interface AnimationLogConsoleProps {
  logs: FlightLabAnimationEvent[];
  copied: boolean;
  onCopyLogs: () => void;
  onClearLogs: () => void;
  onDumpDiagnostics?: () => void;
  copiedRig?: boolean;
  logContainerRef: RefObject<HTMLDivElement | null>;
}

export function AnimationLogConsole({
  logs,
  copied,
  onCopyLogs,
  onClearLogs,
  onDumpDiagnostics,
  copiedRig = false,
  logContainerRef,
}: AnimationLogConsoleProps) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [copiedPinId, setCopiedPinId] = useState<string | null>(null);

  const filteredLogs = logs.filter((item) => {
    if (filter === "all") return true;
    if (filter === "clip") return item.type === "clip" || item.type === "mode";
    if (filter === "pin") return item.type === "pin";
    if (filter === "scan") return item.type === "scan";
    if (filter === "rig") return item.type === "rig" || item.type === "load";
    if (filter === "compare") return item.type === "compare";
    return true;
  });

  const handleCopyPin = async (pinId: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedPinId(pinId);
      setTimeout(() => setCopiedPinId(null), 2200);
    } catch {
      // fallback
    }
  };

  return (
    <div className={styles.logSection}>
      <div className={styles.logHeader}>
        <span>
          Animation & Rig Log <small>({filteredLogs.length})</small>
        </span>
        <div className={styles.logActions}>
          {onDumpDiagnostics && (
            <button
              type="button"
              onClick={onDumpDiagnostics}
              title="Dump complete bone hierarchy, symmetry, and pin report — copied to the clipboard"
              className={styles.dumpBtn}
            >
              {copiedRig ? "✓ Copied Rig Report" : "Dump Rig"}
            </button>
          )}
          <button
            type="button"
            onClick={onCopyLogs}
            title="Copy all logs to clipboard"
            disabled={logs.length === 0}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClearLogs}
            title="Clear event log"
            disabled={logs.length === 0}
          >
            Clear
          </button>
        </div>
      </div>

      <div className={styles.logFilterTabs} aria-label="Log category filters">
        {(["all", "clip", "pin", "scan", "rig", "compare"] as const).map((cat) => (
          <button
            key={cat}
            type="button"
            className={styles.filterTab}
            data-active={filter === cat}
            onClick={() => setFilter(cat)}
          >
            {cat.toUpperCase()}
          </button>
        ))}
      </div>

      <div ref={logContainerRef} className={styles.logConsole} role="log" aria-live="polite">
        {filteredLogs.length === 0 ? (
          <div className={styles.logEmpty}>No events match current filter.</div>
        ) : (
          filteredLogs.map((item) => (
            <div key={item.id} className={styles.logRow} data-type={item.type}>
              <span className={styles.logTime}>{item.timestamp}</span>
              <span className={styles.logTag} data-type={item.type}>
                [{item.type.toUpperCase()}]
              </span>
              <span className={styles.logMsg}>
                {item.message}
                {item.details && <span className={styles.logDetails}> — {item.details}</span>}
              </span>
              {item.pin && (
                <button
                  type="button"
                  className={styles.logPinCopyBtn}
                  onClick={() => handleCopyPin(item.id, item.pin!.aiSnippet)}
                  title="Copy formatted prompt for AI assistant"
                >
                  {copiedPinId === item.id ? "✓ Copied for AI" : "Copy for AI"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
