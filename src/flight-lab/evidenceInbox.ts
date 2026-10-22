/**
 * Node-only half of the dev inbox route.
 *
 * Deliberately free of `next/server` and of `fs`, so `test/flight-lab.test.js`
 * can exercise the parsing and the PNG check without booting Next or touching
 * disk. The route is a thin wrapper: parse -> validate -> atomic write.
 *
 * The filenames are **fixed**, never derived from the request. That is the whole
 * path-traversal defence: a caller can choose what goes in the inbox, not where
 * it goes.
 *
 * The path constants live in `evidenceExport.ts` (which the browser also
 * imports), so the UI, the issue document and this validator cannot drift.
 */

import { CAPTURE_PATH, INBOX_DIR, ISSUE_PATH, TELEMETRY_PATH } from "./evidenceExport";

export { CAPTURE_PATH, INBOX_DIR, ISSUE_PATH, TELEMETRY_PATH };

export const ISSUE_FILENAME = "latest-issue.md";
export const CAPTURE_FILENAME = "latest-capture.png";
export const TELEMETRY_FILENAME = "latest-capture.json";

/** A 1600×1000 PNG is ~1–3 MB; this only has to stop a runaway/abusive body. */
export const MAX_CAPTURE_BYTES = 24 * 1024 * 1024;
export const MAX_MARKDOWN_BYTES = 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface ReportWriteRequest {
  captureId: string;
  /** `data:image/png;base64,...` straight off the canvas. */
  png: string;
  /** The issue document, already formatted for a coding agent. */
  markdown: string;
  /** JSON telemetry sidecar — stored as-is. */
  telemetry: unknown;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function isPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Decode a `data:image/png;base64,` URL. Rejects any other media type, malformed
 * base64, an oversized payload, and — the part a naive implementation misses —
 * a base64 blob that decodes cleanly but is not actually a PNG.
 */
export function decodePngDataUrl(value: unknown): ParseResult<Uint8Array> {
  if (typeof value !== "string") return { ok: false, error: "png must be a data URL string" };
  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) return { ok: false, error: "png must start with data:image/png;base64," };

  const base64 = value.slice(prefix.length);
  if (base64.length === 0) return { ok: false, error: "png payload is empty" };
  // 4 base64 chars -> 3 bytes; check before decoding so a huge body fails fast.
  if ((base64.length * 3) / 4 > MAX_CAPTURE_BYTES) {
    return { ok: false, error: `png exceeds ${MAX_CAPTURE_BYTES} bytes` };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, error: "png payload is not valid base64" };
  }
  if (bytes.length === 0) return { ok: false, error: "png payload decoded to nothing" };
  if (!isPngSignature(bytes)) return { ok: false, error: "png payload is not a PNG (bad signature)" };
  return { ok: true, value: bytes };
}

export function parseReportRequest(raw: unknown): ParseResult<ReportWriteRequest & { pngBytes: Uint8Array }> {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "body must be a JSON object" };
  const body = raw as Record<string, unknown>;

  const png = decodePngDataUrl(body.png);
  if (!png.ok) return png;

  if (typeof body.markdown !== "string" || body.markdown.trim().length === 0) {
    return { ok: false, error: "markdown must be a non-empty string" };
  }
  if (Buffer.byteLength(body.markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return { ok: false, error: `markdown exceeds ${MAX_MARKDOWN_BYTES} bytes` };
  }

  const captureId =
    typeof body.captureId === "string" && body.captureId.trim() ? body.captureId.trim().slice(0, 120) : "capture";

  // `telemetry` is optional, but if it is present it has to survive a round trip
  // — a sidecar that cannot be serialised would be written as `undefined`.
  const telemetry = body.telemetry ?? null;
  try {
    JSON.stringify(telemetry);
  } catch {
    return { ok: false, error: "telemetry is not JSON-serialisable" };
  }

  return {
    ok: true,
    value: { captureId, png: body.png as string, markdown: body.markdown, telemetry, pngBytes: png.value },
  };
}
