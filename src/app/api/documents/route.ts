import fs from "node:fs/promises";
import path from "node:path";
import { handleWrite, HttpError } from "@/lib/http";
import { auditEntry, newId, UPLOAD_DIR, updateState } from "@/lib/state";
import type { DocumentRecord } from "@/lib/types";

const MAX_BYTES = 10 * 1024 * 1024;

/** Detect the real file type from its first bytes (never trust the browser's MIME type). */
function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpeg" };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { mime: "image/gif", ext: "gif" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: "application/pdf", ext: "pdf" };
  return null;
}

export async function POST(request: Request) {
  return handleWrite(request, async () => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES + 64_000) throw new HttpError("File too large (max 10 MB).", 413);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError("Send the file as multipart form data.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError("No file received.", 400);
    if (file.size === 0) throw new HttpError("The file is empty.", 400);
    if (file.size > MAX_BYTES) throw new HttpError("File too large (max 10 MB).", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniff(bytes);
    if (!type) throw new HttpError("Upload a photo (JPEG, PNG, WebP, GIF) or a PDF.", 415);

    const id = newId("up");
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, `${id}.${type.ext}`), bytes);
    const safeName = (file.name || `upload.${type.ext}`).replace(/[^\w.\- ]+/g, "_").slice(0, 80);
    const document = await updateState((s) => {
      const record: DocumentRecord = {
        id,
        origin: "upload",
        fileName: safeName,
        mimeType: type.mime,
        url: `/api/documents/${id}/file`,
        addedAt: new Date().toISOString(),
        reviewStatus: "pending",
        payment: { status: "unpaid" },
      };
      s.documents.push(record);
      s.audit.push(auditEntry({ actor: "owner", message: `Uploaded ${safeName} (${Math.round(file.size / 1024)} KB, ${type.mime}).`, ref: { docId: id } }));
      return record;
    });
    return Response.json({ document }, { status: 201 });
  });
}
