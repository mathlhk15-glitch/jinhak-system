import { parseTranscriptText, type ParsedTranscriptRecord } from "./transcriptParser";
import { parseOfficialTranscriptPositionedPages, type PositionedPdfPage } from "./officialPdfParser";

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

interface PositionedTextItem { x: number; text: string; }
interface PositionedTextLine { y: number; items: PositionedTextItem[]; text: string; }

/**
 * 학교생활기록부의 학기 셀은 여러 과목 행을 세로로 병합(rowspan)한다.
 * PDF 텍스트 추출 순서만 믿으면 병합 셀의 1/2가 과목 행들 사이에 끼어 나오므로
 * 2학기 과목이 1학기로 잘못 붙는 문제가 생긴다.
 *
 * 여기서는 PDF.js가 주는 좌표를 보존한 뒤, 학기 열의 단독 숫자(1/2) 위치와
 * 각 성적 행의 y 좌표를 비교하여 가장 가까운 학기 셀을 명시적으로 주입한다.
 */
function groupTextItemsIntoLines(items: any[]): PositionedTextLine[] {
  const rows: Array<{ y: number; items: PositionedTextItem[] }> = [];
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
  return rows.map((row) => {
    const sorted = row.items.sort((a, b) => a.x - b.x);
    return { y: row.y, items: sorted, text: sorted.map((x) => x.text).join("\t") };
  });
}

function looksLikeTranscriptDataRow(line: PositionedTextLine): boolean {
  const tokens = line.items.map((x) => x.text.trim()).filter(Boolean);
  if (tokens.length < 3) return false;
  if (tokens.some((t) => /20\d{2}[.년/-]/.test(t))) return false;
  if (tokens.some((t) => /이수학점|합계|수강자수|석차등급|학점수|단위수/.test(t))) return false;

  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^(\d{1,2})(?:학점|단위)?$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 20) continue;
    const after = tokens.slice(i + 1);
    const hasEvaluation = after.some((t) =>
      /^[ABCDE](?:\(|$)/.test(t) || /^[1-9]$/.test(t) || /^[PF]$/.test(t)
    );
    if (hasEvaluation) return true;
  }
  return false;
}

export function injectSemesterByGeometry(lines: PositionedTextLine[]): string[] {
  // 병합된 '학기' 열은 대부분 페이지 왼쪽에 단독 1/2로 존재한다.
  // x 임계값은 특정 학교 양식 한 곳에만 고정하지 않도록 충분히 넓게 둔다.
  const semesterMarkers = lines
    .flatMap((line) =>
      line.items
        .filter((item) => /^[12]$/.test(item.text) && item.x < 110)
        .map((item) => ({ y: line.y, semester: Number(item.text) as 1 | 2 }))
    )
    .sort((a, b) => b.y - a.y);

  if (semesterMarkers.length === 0) return lines.map((line) => line.text);

  return lines.map((line) => {
    if (!looksLikeTranscriptDataRow(line)) return line.text;

    // PDF.js 좌표계의 방향과 무관하게 절대거리로 판단한다.
    // 정확히 중간이면 문서 진행 방향상 뒤의 학기(통상 2학기)를 선택한다.
    let best = semesterMarkers[0];
    let bestDistance = Math.abs(line.y - best.y);
    for (let i = 1; i < semesterMarkers.length; i++) {
      const marker = semesterMarkers[i];
      const distance = Math.abs(line.y - marker.y);
      // 병합 셀 중심의 정확한 중간점과 새 학기 첫 과목 baseline이 거의 겹치는
      // 실제 NEIS PDF가 있다. 8px 이내의 경계 영역은 문서 진행 방향상 뒤의
      // 학기 마커를 선택해 첫 2학기 과목이 1학기로 붙는 현상을 막는다.
      if (distance <= bestDistance + 8) {
        best = marker;
        bestDistance = distance;
      }
    }
    return `[[SEM:${best.semester}]]\t${line.text}`;
  });
}

async function extractPdfText(
  file: File,
  onProgress?: (p: ImportProgress) => void
): Promise<{ pdf: any; text: string; positionedPages: PositionedPdfPage[] }> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  const positionedPages: PositionedPdfPage[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    onProgress?.({ stage: `PDF 텍스트 읽는 중 (${pageNo}/${pdf.numPages})`, percent: Math.round((pageNo / pdf.numPages) * 40) });
    const page = await pdf.getPage(pageNo);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const positionedItems = (content.items ?? [])
      .map((item: any) => ({
        x: Number(item.transform?.[4] ?? 0),
        // PDF.js의 transform[5]는 아래에서 위로 증가한다. 화면의 위→아래 좌표로 변환한다.
        top: Number(viewport.height) - Number(item.transform?.[5] ?? 0),
        text: String(item.str ?? "").trim(),
      }))
      .filter((item: any) => item.text.length > 0);
    positionedPages.push({
      pageNumber: pageNo,
      width: Number(viewport.width),
      height: Number(viewport.height),
      items: positionedItems,
    });

    // rawText는 디버깅/일반 PDF fallback용이다. 실제 학교생활기록부 성적은
    // positionedPages의 표 좌표 파서가 우선 처리한다.
    pages.push(groupTextItemsIntoLines(content.items ?? []).map((line) => line.text).join("\n"));
  }
  return { pdf, text: pages.join("\n"), positionedPages };
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
    const { pdf, text, positionedPages } = await extractPdfText(file, onProgress);
    if (text.replace(/\s/g, "").length >= 120) {
      // 텍스트형 학교생활기록부는 일반 문장 파싱보다 표의 x/y 좌표를 우선한다.
      // 봉사활동 날짜를 과목으로 오인하거나 rowspan 학기 셀 때문에 2학기가 사라지는 문제를 차단한다.
      const official = parseOfficialTranscriptPositionedPages(positionedPages);
      const parsed = official.records.length > 0 ? official : parseTranscriptText(text);
      onProgress?.({ stage: official.records.length > 0 ? "학생부 성적표 정밀 분석 완료" : "PDF 성적 분석 완료", percent: 100 });
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
