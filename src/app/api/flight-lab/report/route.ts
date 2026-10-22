import { access, mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  CAPTURE_FILENAME,
  CAPTURE_PATH,
  INBOX_DIR,
  ISSUE_FILENAME,
  ISSUE_PATH,
  MAX_CAPTURE_BYTES,
  MAX_MARKDOWN_BYTES,
  TELEMETRY_FILENAME,
  TELEMETRY_PATH,
  parseReportRequest,
} from "../../../../flight-lab/evidenceInbox";

/**
 * Dev-only evidence inbox.
 *
 * Flight Lab's `Export` and `Save for AI` post here instead of downloading to
 * `~/Downloads`, so the screenshot and the ticket land in the repo where a coding
 * agent can be pointed at them: "fix the issue in docs/flight-lab/inbox/latest-issue.md".
 *
 * Three properties this route has to hold:
 *  - **Dev only.** It writes to disk on behalf of a page, so it 404s outside
 *    `next dev` rather than trusting the deployment to be private.
 *  - **Fixed paths.** Content is caller-supplied, the destination is not.
 *  - **Atomic.** A temp file is renamed into place, so an agent that reads the
 *    file while a second export is running gets one complete document, never half
 *    of two.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** base64 inflates by 4/3; leave room for the markdown and the JSON sidecar. */
const MAX_BODY_BYTES = MAX_CAPTURE_BYTES * 2 + MAX_MARKDOWN_BYTES;

const isDev = () => process.env.NODE_ENV !== "production";

const inboxDir = () => path.join(process.cwd(), "docs", "flight-lab", "inbox");

async function writeAtomic(target: string, data: string | Uint8Array): Promise<number> {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, data);
  await rename(temp, target);
  return (await stat(target)).size;
}

function notFound() {
  return NextResponse.json({ ok: false, error: "The evidence inbox only exists under `next dev`." }, { status: 404 });
}

export async function POST(request: Request) {
  if (!isDev()) return notFound();

  // Refuse to create `docs/flight-lab/inbox` somewhere that is not this repo.
  // `process.cwd()` is the project root under `next dev`; if it is not, the
  // route is being mounted from somewhere unexpected and writing would litter.
  try {
    await access(path.join(process.cwd(), "package.json"));
  } catch {
    return NextResponse.json(
      { ok: false, error: `refusing to write: ${process.cwd()} does not look like the repo root` },
      { status: 500 },
    );
  }

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: `body exceeds ${MAX_BODY_BYTES} bytes` }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "body is not JSON" }, { status: 400 });
  }

  const parsed = parseReportRequest(raw);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });

  const { captureId, markdown, telemetry, pngBytes } = parsed.value;

  const dir = inboxDir();
  try {
    await mkdir(dir, { recursive: true });
    const captureBytes = await writeAtomic(path.join(dir, CAPTURE_FILENAME), pngBytes);
    const issueBytes = await writeAtomic(path.join(dir, ISSUE_FILENAME), markdown);
    const telemetryBytes = await writeAtomic(
      path.join(dir, TELEMETRY_FILENAME),
      `${JSON.stringify(telemetry, null, 2)}\n`,
    );

    return NextResponse.json({
      ok: true,
      captureId,
      written: [
        { path: CAPTURE_PATH, bytes: captureBytes },
        { path: ISSUE_PATH, bytes: issueBytes },
        { path: TELEMETRY_PATH, bytes: telemetryBytes },
      ],
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** What is in the inbox right now — used by the probe and by `Save for AI`'s UI. */
export async function GET() {
  if (!isDev()) return notFound();

  const dir = inboxDir();
  const files = await Promise.all(
    [CAPTURE_FILENAME, ISSUE_FILENAME, TELEMETRY_FILENAME].map(async (name) => {
      try {
        const info = await stat(path.join(dir, name));
        return { path: `${INBOX_DIR}/${name}`, bytes: info.size, modifiedAt: info.mtime.toISOString() };
      } catch {
        return { path: `${INBOX_DIR}/${name}`, bytes: 0, modifiedAt: null };
      }
    }),
  );

  return NextResponse.json({ ok: true, dir: INBOX_DIR, files });
}
