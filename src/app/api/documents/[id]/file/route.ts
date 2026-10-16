import fs from "node:fs/promises";
import path from "node:path";
import { readState, UPLOAD_DIR } from "@/lib/state";

export async function GET(_request: Request, ctx: RouteContext<"/api/documents/[id]/file">) {
  const { id } = await ctx.params;
  if (!/^up_[a-f0-9]{12}$/.test(id)) return new Response("Not found", { status: 404 });
  const doc = (await readState()).documents.find((d) => d.id === id);
  if (!doc) return new Response("Not found", { status: 404 });
  const ext = doc.mimeType === "application/pdf" ? "pdf" : doc.mimeType.split("/")[1];
  try {
    const bytes = await fs.readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ UPLOAD_DIR, `${id}.${ext}`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.mimeType,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="${doc.fileName.replace(/"/g, "")}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
