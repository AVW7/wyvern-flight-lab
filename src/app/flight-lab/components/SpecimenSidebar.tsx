"use client";

import type { FlightLabSpecimen } from "../../../flight-lab/catalog";
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
}

export function SpecimenSidebar({
  searchQuery,
  onSearchChange,
  specimens,
  selectedId,
  onSelectSpecimen,
  specimen,
  clipDetailsCount,
  metrics,
}: SpecimenSidebarProps) {
  return (
    <aside className={styles.specimens} aria-label="Wyvern specimens">
      <div className={styles.sectionLabel}>Flight specimens</div>

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

      {specimens.length === 0 ? (
        <div className={styles.emptySearch}>No specimens match &quot;{searchQuery}&quot;</div>
      ) : (
        specimens.map((item, index) => (
          <div key={item.id} className={styles.specimenEntry}>
            {index > 0 && item.kind !== specimens[index - 1]?.kind && (
              <div className={styles.rosterDivider}>Egg archive</div>
            )}
            <button
              type="button"
              className={styles.specimen}
              data-active={item.id === selectedId}
              onClick={() => onSelectSpecimen(item.id)}
            >
              <span className={styles.specimenIndex}>{String(index + 1).padStart(2, "0")}</span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.className}</small>
              </span>
            </button>
          </div>
        ))
      )}

      <div className={styles.specimenNote}>
        <div className={styles.specimenNoteHeader}>
          <span>Selected specimen</span>
          <span className={styles.specimenBadge}>
            {clipDetailsCount > 0 ? `${clipDetailsCount} CLIPS` : "STATIC MESH"}
          </span>
        </div>
        <strong>{specimen.name}</strong>
        <p>{specimen.description}</p>
        <div className={styles.specimenMetaGrid}>
          <div>
            <span>Model</span>
            <strong>{specimen.modelFile}</strong>
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
