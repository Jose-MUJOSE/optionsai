// ============================================================
// OptionsAI - Chat image upload helpers (Phase 7b)
// ============================================================
// Reads File/Blob → resizes to MAX_LONG_EDGE → returns a data: URL.
// Keeps payloads reasonable for OpenAI-compatible vision models.
// ============================================================

"use client";

const MAX_LONG_EDGE = 1600;       // px — cap the longest side
const JPEG_QUALITY = 0.85;         // re-encode opaque images as JPEG
const MAX_IMAGES_PER_MESSAGE = 4;  // Safety cap
const MAX_SINGLE_BYTES = 8 * 1024 * 1024; // 8 MB raw-file cap

export interface ProcessedImage {
  /** data:image/...;base64,... */
  dataUrl: string;
  /** MIME sent in the data URL */
  mime: string;
  /** Final encoded byte length (approx) */
  bytes: number;
  /** Output pixel dimensions */
  width: number;
  height: number;
}

export const imageUploadLimits = {
  maxLongEdge: MAX_LONG_EDGE,
  maxImagesPerMessage: MAX_IMAGES_PER_MESSAGE,
  maxSingleBytes: MAX_SINGLE_BYTES,
};

function readFileAsDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * Resize a user-provided image to keep long edge <= MAX_LONG_EDGE,
 * re-encode as JPEG unless the source was transparent PNG.
 */
export async function processImageFile(file: File | Blob): Promise<ProcessedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("unsupported file type");
  }
  if (file.size > MAX_SINGLE_BYTES) {
    throw new Error(`image too large (> ${Math.round(MAX_SINGLE_BYTES / 1024 / 1024)}MB)`);
  }

  const originalDataUrl = await readFileAsDataURL(file);
  const img = await loadImage(originalDataUrl);

  const longEdge = Math.max(img.width, img.height);
  const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
  const outW = Math.max(1, Math.round(img.width * scale));
  const outH = Math.max(1, Math.round(img.height * scale));

  // If no resize is needed AND source is already a supported format, return as-is
  if (scale === 1 && (file.type === "image/jpeg" || file.type === "image/webp")) {
    return {
      dataUrl: originalDataUrl,
      mime: file.type,
      bytes: file.size,
      width: img.width,
      height: img.height,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");

  // Fill white background for JPEG so transparent PNGs don't turn black
  const outputMime = file.type === "image/png" ? "image/png" : "image/jpeg";
  if (outputMime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outW, outH);
  }
  ctx.drawImage(img, 0, 0, outW, outH);

  const dataUrl = canvas.toDataURL(outputMime, outputMime === "image/jpeg" ? JPEG_QUALITY : undefined);
  const bytes = Math.round(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

  return { dataUrl, mime: outputMime, bytes, width: outW, height: outH };
}

/** Find image items in a DataTransfer (drag-drop) or ClipboardEvent payload. */
export function extractImageFiles(items: DataTransferItemList | FileList | null): File[] {
  if (!items) return [];
  const out: File[] = [];
  if ("length" in items) {
    for (let i = 0; i < items.length; i += 1) {
      const entry = items[i] as DataTransferItem | File;
      if (entry instanceof File) {
        if (entry.type.startsWith("image/")) out.push(entry);
        continue;
      }
      if ("kind" in entry && entry.kind === "file" && entry.type.startsWith("image/")) {
        const f = entry.getAsFile();
        if (f) out.push(f);
      }
    }
  }
  return out;
}
