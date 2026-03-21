import { PDFDocument } from "pdf-lib";

export const A4_WIDTH_PT  = 595.28;
export const A4_HEIGHT_PT = 841.89;

export async function normalizePdfToA4(
  input: Uint8Array | ArrayBuffer
): Promise<Uint8Array> {
  const dstDoc = await PDFDocument.create();

  let embeddedPages;
  try {
    embeddedPages = await dstDoc.embedPdf(input);
  } catch (err) {
    console.warn("[pdf-normalize] embedPdf failed, returning original:", err);
    return input instanceof Uint8Array ? input : new Uint8Array(input);
  }

  for (const embedded of embeddedPages) {
    const srcW = embedded.width;
    const srcH = embedded.height;
    const scale  = Math.min(A4_WIDTH_PT / srcW, A4_HEIGHT_PT / srcH);
    const drawnW = srcW * scale;
    const drawnH = srcH * scale;
    const x = (A4_WIDTH_PT  - drawnW) / 2;
    const y = (A4_HEIGHT_PT - drawnH) / 2;
    const dstPage = dstDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    dstPage.drawPage(embedded, { x, y, width: drawnW, height: drawnH });
  }

  return dstDoc.save();
}

export async function normalizeImageToA4Pdf(
  input: Uint8Array | ArrayBuffer,
  contentType: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  let image;
  if (contentType.includes("png")) {
    image = await pdfDoc.embedPng(bytes);
  } else {
    image = await pdfDoc.embedJpg(bytes);
  }

  const { width: imgW, height: imgH } = image;
  const scale  = Math.min(A4_WIDTH_PT / imgW, A4_HEIGHT_PT / imgH);
  const drawnW = imgW * scale;
  const drawnH = imgH * scale;
  const x = (A4_WIDTH_PT  - drawnW) / 2;
  const y = (A4_HEIGHT_PT - drawnH) / 2;

  const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  page.drawImage(image, { x, y, width: drawnW, height: drawnH });

  return pdfDoc.save();
}

export function isPdfBytes(bytes: ArrayBuffer): boolean {
  if (bytes.byteLength < 4) return false;
  const view = new Uint8Array(bytes, 0, 4);
  return view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46;
}

export function isImageBytes(bytes: ArrayBuffer): "png" | "jpeg" | null {
  if (bytes.byteLength < 4) return null;
  const view = new Uint8Array(bytes, 0, 4);
  if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) return "png";
  if (view[0] === 0xff && view[1] === 0xd8) return "jpeg";
  return null;
}
