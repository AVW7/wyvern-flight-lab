// Shared membrane crease metrics for WyvernMembrane_ExportSafe audits.
// A flat shared edge scores 0 degrees; a right-angle fold scores 90.
// Ranking is area-weighted (angle * min adjacent face area) so tiny
// triangles do not dominate selection. See docs/flight-lab/21-local-membrane-crease-study.md.

export function triangleEdges(indices) {
  const edges = new Map();
  for (let f = 0; f < indices.length; f += 3) {
    const tri = [indices[f], indices[f + 1], indices[f + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!edges.has(key)) edges.set(key, { vertices: a < b ? [a, b] : [b, a], faces: [] });
      edges.get(key).faces.push(f / 3);
    }
  }
  return [...edges.values()];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function measureCreases(positions, indices, edges) {
  const faceCount = indices.length / 3;
  const normals = new Array(faceCount);
  const areas = new Array(faceCount);
  let degenerateFaces = 0;
  for (let f = 0; f < faceCount; f++) {
    const a = positions[indices[f * 3]];
    const b = positions[indices[f * 3 + 1]];
    const c = positions[indices[f * 3 + 2]];
    const n = cross(sub(b, a), sub(c, a));
    const len = length(n);
    areas[f] = len / 2;
    if (len <= 1e-12) {
      degenerateFaces++;
      normals[f] = null;
    } else {
      normals[f] = [n[0] / len, n[1] / len, n[2] / len];
    }
  }

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  const scored = [];
  for (const edge of edges) {
    if (edge.faces.length === 1) {
      boundaryEdges++;
      continue;
    }
    if (edge.faces.length !== 2) {
      nonManifoldEdges++;
      continue;
    }
    const n1 = normals[edge.faces[0]];
    const n2 = normals[edge.faces[1]];
    if (!n1 || !n2) continue;
    const dot = Math.max(-1, Math.min(1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const score = angleDeg * Math.min(areas[edge.faces[0]], areas[edge.faces[1]]);
    scored.push({ vertices: edge.vertices, angleDeg, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const angles = scored.map(e => e.angleDeg).sort((a, b) => a - b);
  const percentile = p => (angles.length ? angles[Math.min(angles.length - 1, Math.floor((p / 100) * angles.length))] : 0);
  const meanAngleDeg = angles.length ? angles.reduce((s, v) => s + v, 0) / angles.length : 0;

  return {
    maxAngleDeg: angles.length ? angles[angles.length - 1] : 0,
    p95AngleDeg: percentile(95),
    meanAngleDeg,
    boundaryEdges,
    nonManifoldEdges,
    degenerateFaces,
    worstEdges: scored.slice(0, 8),
  };
}
