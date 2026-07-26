/**
 * Asset upload: save attached images to disk so the agent can use them
 * in the final rendered video.
 *
 * The bug we're fixing: when a user attaches an image to a chat message,
 * the image is sent to the agent as a base64 data URL. The agent sees
 * it, extracts the style, and (when asked to use it) calls
 * add_image_element with the data URL as `src`. The data URL persists
 * in the composition JSON and the data URL renders in the live preview
 * (the browser handles data: natively). But the EXPORTED video fails:
 * Remotion's <Img> doesn't reliably embed data URLs into MP4 frames,
 * and even when it does, the composition JSON balloons to many MB
 * because of the embedded base64.
 *
 * The fix: when the user attaches an image, the server saves it to
 * public/uploads/<id>.<ext> and returns a saved URL. The chat message
 * carries BOTH the data URL (for the model's vision to see the image)
 * AND the saved URL (for the agent to use in add_image_element). The
 * agent is told: "use the saved URL `/uploads/abc.jpg`, not the data
 * URL, when constructing elements."
 *
 * Files are saved under public/uploads/ so:
 *   - the dev server (Vite) serves them at /uploads/* automatically
 *   - the production server (Express) serves them via app.use static
 *   - the Remotion renderer can fetch them via staticFile() wrapping
 *     or directly over HTTP during the render
 */

import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");

// Frontend URL path (used as the image src in the composition).
export const UPLOADS_URL_PREFIX = "/uploads";

/**
 * Decode a base64 data URL and write it to public/uploads/. Returns
 * the saved URL (e.g. "/uploads/abc123.jpg"). The file is named with
 * a nanoid so two uploads of the same image don't collide.
 *
 * Accepted data URL formats:
 *   data:image/jpeg;base64,/9j/4AAQ...
 *   data:image/png;base64,iVBORw0KG...
 *   data:image/webp;base64,...
 *
 * If the input is not a data URL (e.g. an already-uploaded URL or a
 * file:// path), this returns it unchanged - the caller can then
 * decide whether to error.
 */
export async function saveDataUrl(dataUrl: string): Promise<string> {
  if (!dataUrl.startsWith("data:")) {
    // Not a data URL - return as-is. The caller may be passing a URL
    // it already has, or this could be an error case.
    return dataUrl;
  }

  const match = /^data:([^;,]+)(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error(`saveDataUrl: malformed data URL (could not parse header).`);
  }
  const mime = match[1]; // e.g. "image/jpeg"
  const payload = match[2]; // base64 or url-encoded payload

  const ext = mimeToExt(mime);
  if (!ext) {
    throw new Error(`saveDataUrl: unsupported mime type "${mime}".`);
  }

  // The payload is base64 if the data URL had ;base64, otherwise url-encoded.
  // We require ;base64 for binary safety - url-encoded image data is rare.
  const isBase64 = dataUrl.includes(";base64,");
  if (!isBase64) {
    throw new Error(
      `saveDataUrl: only base64-encoded data URLs are accepted. ` +
        `Got a url-encoded data URL (${mime}). Re-encode as base64 before uploading.`,
    );
  }

  const buffer = Buffer.from(payload, "base64");
  if (buffer.length === 0) {
    throw new Error(`saveDataUrl: data URL had zero-length payload.`);
  }

  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${nanoid(12)}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);
  await fs.writeFile(filePath, buffer);

  return `${UPLOADS_URL_PREFIX}/${filename}`;
}

function mimeToExt(mime: string): string | null {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    case "image/avif":
      return "avif";
    default:
      return null;
  }
}

/**
 * Best-effort cleanup of orphaned uploads. Walks public/uploads/ and
 * removes any file that isn't referenced by any scene element's src.
 * Safe to run periodically; we don't surface this to the user.
 */
export async function gcUploads(referencedUrls: Set<string>): Promise<number> {
  let removed = 0;
  try {
    const entries = await fs.readdir(UPLOADS_DIR);
    for (const name of entries) {
      const url = `${UPLOADS_URL_PREFIX}/${name}`;
      if (!referencedUrls.has(url)) {
        await fs.unlink(path.join(UPLOADS_DIR, name)).catch(() => {});
        removed++;
      }
    }
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
      // No uploads directory yet - nothing to do.
      return 0;
    }
    throw err;
  }
  return removed;
}
