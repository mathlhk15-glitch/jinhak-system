import { parseTranscriptText, type ParsedTranscriptRecord } from "./transcriptParser";

export interface ImportProgress { stage: string; percent?: number; }
export interface DocumentImportResult {
  records: ParsedTranscriptRecord[];
  rawText: string;
  warnings: string[];
  method: "pdf-text" | "pdf-ocr" | "image-ocr";
}

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.mjs";
const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.mjs";
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.esm.min.js";

async function loadPdfJs(): Promise<any> {
  const pdfjs = await import(/* @vite-ignore */ PDFJS_URL);
  if (pdfjs?.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  return pdfjs;
}
async function loadTesseract(): Promise<any> {
  return await import(/* @vite-ignore */ TESSERACT_URL);
}

function groupTextItemsIntoLines(items: any[]): string[] {
  const rows: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];
  for (const item of items) {
    const text = String(item.str ?? "").trim();
    if (!text) continue;
    const x = Number(item.transform?.[4] ?? 0);
    const y = Number(item.transform?.[5] ?? 0);
    let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ x, text });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((x) => x.text).join("\t"));
}

async function extractPdfText(file: File, onProgress?: (p: ImportProgress) => void): Promise<{ pdf: any; text: string }> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    onProgress?.({ stage: `PDF 텍스트 읽는 중 (${pageNo}/${pdf.numPages})`, percent: Math.round((pageNo / pdf.numPages) * 40) });
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    pages.push(groupTextItemsIntoLines(content.items ?? []).join("\n"));
  }
  return { pdf, text: pages.join("\n") };
}

async function createOcrWorker(onProgress?: (p: ImportProgress) => void): Promise<any> {
  const Tesseract = await loadTesseract();
  return await Tesseract.createWorker("kor+eng", undefined, {
    logger: (m: any) => {
      if (typeof m?.progress === "number") {
        onProgress?.({ stage: m.status ? `OCR: ${m.status}` : "OCR 처리 중", percent: Math.round(40 + m.progress * 55) });
      }
    },
  });
}

async function ocrImage(source: File | HTMLCanvasElement, onProgress?: (p: ImportProgress) => void): Promise<string> {
  const worker = await createOcrWorker(onProgress);
  try {
    const result = await worker.recognize(source as any);
    return String(result?.data?.text ?? "");
  } finally {
    await worker.terminate();
  }
}

async function ocrPdf(pdf: any, onProgress?: (p: ImportProgress) => void): Promise<string> {
  const worker = await createOcrWorker(onProgress);
  try {
    const texts: string[] = [];
    const maxPages = Math.min(pdf.numPages, 12);
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      onProgress?.({ stage: `스캔 PDF OCR 중 (${pageNo}/${maxPages})`, percent: Math.round(40 + ((pageNo - 1) / maxPages) * 55) });
      const page = await pdf.getPage(pageNo);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const result = await worker.recognize(canvas);
      texts.push(String(result?.data?.text ?? ""));
    }
    return texts.join("\n");
  } finally {
    await worker.terminate();
  }
}

export async function importTranscriptDocument(file: File, onProgress?: (p: ImportProgress) => void): Promise<DocumentImportResult> {
  onProgress?.({ stage: "파일 확인 중", percent: 2 });
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const { pdf, text } = await extractPdfText(file, onProgress);
    if (text.replace(/\s/g, "").length >= 120) {
      const parsed = parseTranscriptText(text);
      onProgress?.({ stage: "PDF 성적 분석 완료", percent: 100 });
      return { records: parsed.records, rawText: text, warnings: parsed.warnings, method: "pdf-text" };
    }
    onProgress?.({ stage: "텍스트가 없는 PDF입니다. OCR로 전환합니다.", percent: 42 });
    const ocrText = await ocrPdf(pdf, onProgress);
    const parsed = parseTranscriptText(ocrText);
    return { records: parsed.records, rawText: ocrText, warnings: ["스캔 PDF는 OCR 오인식 가능성이 높습니다. 모든 행을 확인하세요.", ...parsed.warnings], method: "pdf-ocr" };
  }
  if (file.type.startsWith("image/")) {
    const text = await ocrImage(file, onProgress);
    const parsed = parseTranscriptText(text);
    return { records: parsed.records, rawText: text, warnings: ["사진/OCR 결과는 숫자 오인식 가능성이 있습니다. 모든 행을 확인하세요.", ...parsed.warnings], method: "image-ocr" };
  }
  throw new Error("PDF 또는 이미지 파일만 사용할 수 있습니다.");
}
