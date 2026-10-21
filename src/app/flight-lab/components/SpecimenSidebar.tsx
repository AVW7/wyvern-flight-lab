"use client";

import { useMemo, type Ref } from "react";
import { FLIGHT_LAB_SPECIMENS, type FlightLabSpecimen } from "../../../flight-lab/catalog";
import type { FlightLabMeshMetrics } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

interface SpecimenSidebarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  specimens: readonly FlightLabSpecimen[];
  selectedId: string;
  onSelectSpecimen: (id: string) => void;
  specimen: FlightLabSpecimen;
  clipDetailsCount: number;
  metrics: FlightLabMeshMetrics | null;
  /** True while the selected specimen's model is loading. */
  loading: boolean;
  panelRef?: Ref<HTMLElement>;
}

const KIND_LABELS: Record<FlightLabSpecimen["kind"], string> = {
  wyvern: "Flight roster",
  egg: "Egg archive",
};

export function SpecimenSidebar({
  searchQuery,
  onSearchChange,
  specimens,
  selectedId,
  onSelectSpecimen,
  specimen,
  clipDetailsCount,
  metrics,
  loading,
  panelRef,
}: SpecimenSidebarProps) {
  // Numbering is by catalogue position, never by filtered position — the
  // index must not renumber under the user's keystrokes.
  const catalogNumber = useMemo(
    () => new Map(FLIGHT_LAB_SPECIMENS.map((item, index) => [item.id, index + 1])),
    []
  );

  // Group by kind in roster order. Group headers only earn their space when
  // there is more than one group; a single group is covered by the section label.
  const groups = useMemo(() => {
    const order: FlightLabSpecimen["kind"][] = [];
    const byKind = new Map<FlightLabSpecimen["kind"], FlightLabSpecimen[]>();
    for (const item of specimens) {
      const bucket = byKind.get(item.kind);
      if (bucket) {
        bucket.push(item);
      } else {
        byKind.set(item.kind, [item]);
        order.push(item.kind);
      }
    }
    return order.map((kind) => ({ kind, items: byKind.get(kind) ?? [] }));
  }, [specimens]);

  // While the next specimen loads, keep the previous metrics mounted (dimmed)
  // instead of unmounting them — the card must not collapse mid-load.
  const metricsStale = loading && metrics !== null;

  return (
    <aside
      id="specimen-panel"
      ref={panelRef}
      className={styles.specimens}
      aria-label="Wyvern specimens"
      aria-busy={loading || undefined}
      tabIndex={-1}
    >
      <div className={styles.sidebarHead}>
        <div className={styles.sidebarHeadRow}>
          <div className={styles.sectionLabel}>Flight specimens</div>
          <span className={styles.resultCount} role="status">
            {specimens.length} / {FLIGHT_LAB_SPECIMENS.length}
          </span>
        </div>
        <div className={styles.searchBox}>
          <input
            type="search"
            placeholder="Search specimens..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className={styles.searchInput}
            aria-label="Filter specimens"
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {specimens.length === 0 ? (
        <div className={styles.emptySearch} role="status">
          No specimens match &quot;{searchQuery}&quot;
        </div>
      ) : (
        groups.map((group) => (
          <div
            key={group.kind}
            className={styles.rosterGroup}
            role="list"
            aria-label={KIND_LABELS[group.kind]}
          >
            {groups.length > 1 && (
              <div className={styles.rosterGroupLabel}>{KIND_LABELS[group.kind]}</div>
            )}
            {group.items.map((item) => (
              <div key={item.id} className={styles.specimenEntry} role="listitem">
                <button
                  type="button"
                  className={styles.specimen}
                  data-active={item.id === selectedId}
                  aria-current={item.id === selectedId ? "true" : undefined}
                  onClick={() => onSelectSpecimen(item.id)}
                >
                  <span className={styles.specimenIndex}>
                    {String(catalogNumber.get(item.id) ?? 0).padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.className}</small>
                  </span>
                </button>
              </div>
            ))}
          </div>
        ))
      )}

      <div className={styles.specimenNote}>
        <div className={styles.specimenNoteHeader}>
          <span>Selected specimen</span>
          <span className={styles.specimenBadge} data-loading={loading ? "true" : undefined}>
            {loading
              ? "LOADING…"
              : clipDetailsCount > 0
                ? `${clipDetailsCount} CLIPS`
                : "STATIC MESH"}
          </span>
        </div>
        <strong>{specimen.name}</strong>
        <p>{specimen.description}</p>
        <div className={styles.specimenMetaGrid} data-stale={metricsStale ? "true" : undefined}>
          <div className={styles.specimenMetaFull}>
            <span>Model</span>
            <strong title={specimen.modelFile}>{specimen.modelFile}</strong>
          </div>
          <div>
            <span>Target scale</span>
            <strong>{specimen.targetSize}m</strong>
          </div>
          {metrics && (
            <>
              <div>
                <span>Triangles</span>
                <strong>{metrics.triangles.toLocaleString()}</strong>
              </div>
              <div>
                <span>Vertices</span>
                <strong>{metrics.vertices.toLocaleString()}</strong>
              </div>
              <div className={styles.specimenMetaFull}>
                <span>Dimensions</span>
                <strong>
                  {metrics.dimensions.width.toFixed(1)}m × {metrics.dimensions.height.toFixed(1)}m ×{" "}
                  {metrics.dimensions.depth.toFixed(1)}m
                </strong>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
