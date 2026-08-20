import type { AchievementLevel, SubjectGroup } from "../models/academic";
import { inferSubjectGroup, type ParsedTranscriptRecord } from "./transcriptParser";

export interface PositionedPdfTextItem {
  x: number;
  top: number;
  text: string;
}

export interface PositionedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  items: PositionedPdfTextItem[];
}

export interface PositionedTranscriptParseResult {
  records: ParsedTranscriptRecord[];
  warnings: string[];
}

type TableKind = "rankGrade" | "achievement";

interface TextLine {
  top: number;
  items: PositionedPdfTextItem[];
  text: string;
}

interface TableHeader {
  top: number;
  kind: TableKind;
  semesterX: number;
  subjectX: number;
  courseX: number;
  creditX: number;
  scoreX: number;
  achievementX: number;
  rankX?: number;
  noteX?: number;
}

const LINE_TOLERANCE = 2.8;
const HEADER_VERTICAL_TOLERANCE = 16;
const ROW_BASELINE_TOLERANCE = 3.2;
const WRAPPED_CELL_TOLERANCE = 13.1;
const SEMESTER_BOUNDARY_BIAS = 4.0;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `parsed_${crypto.randomUUID()}`;
  return `parsed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

function normalizeCellText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/비\s+평/g, "비평")
    .replace(/독해와\s+작문/g, "독해와 작문")
    .trim();
}

function groupLines(items: PositionedPdfTextItem[]): TextLine[] {
  const rows: Array<{ top: number; items: PositionedPdfTextItem[] }> = [];
  const sorted = [...items].sort((a, b) => a.top - b.top || a.x - b.x);
  for (const item of sorted) {
    const text = item.text.trim();
    if (!text) continue;
    let row = rows.find((r) => Math.abs(r.top - item.top) <= LINE_TOLERANCE);
    if (!row) {
      row = { top: item.top, items: [] };
      rows.push(row);
    }
    row.items.push({ ...item, text });
  }
  rows.sort((a, b) => a.top - b.top);
  return rows.map((row) => {
    const rowItems = [...row.items].sort((a, b) => a.x - b.x);
    return { top: row.top, items: rowItems, text: rowItems.map((x) => x.text).join("\t") };
  });
}

function pageText(lines: TextLine[]): string {
  return lines.map((line) => line.text).join("\n");
}

function detectGradeMarker(lines: TextLine[]): 1 | 2 | 3 | undefined {
  for (const line of lines) {
    const c = compact(line.text);
    const bracket = c.match(/\[([123])학년\]/);
    if (bracket) return Number(bracket[1]) as 1 | 2 | 3;
  }
  return undefined;
}

function findNearbyItem(
  items: PositionedPdfTextItem[],
  top: number,
  predicate: (text: string) => boolean
): PositionedPdfTextItem | undefined {
  return items
    .filter((item) => Math.abs(item.top - top) <= HEADER_VERTICAL_TOLERANCE && predicate(item.text))
    .sort((a, b) => Math.abs(a.top - top) - Math.abs(b.top - top) || a.x - b.x)[0];
}

function findTableHeaders(page: PositionedPdfPage): TableHeader[] {
  const headers: TableHeader[] = [];
  const semesterLabels = page.items.filter((item) => item.text.trim() === "학기");

  for (const semesterLabel of semesterLabels) {
    const top = semesterLabel.top;
    const subject = findNearbyItem(page.items, top, (text) => text.trim() === "교과");
    const course = findNearbyItem(page.items, top, (text) => text.trim() === "과목");
    const credit = findNearbyItem(page.items, top, (text) => /^(학점수|단위수)$/.test(text.trim()));
    if (!subject || !course || !credit) continue;

    const score = findNearbyItem(page.items, top, (text) => compact(text).includes("원점수/과목평균"));
    const achievement = findNearbyItem(page.items, top, (text) => text.trim() === "성취도");
    if (!achievement) continue;
    const rank = findNearbyItem(page.items, top, (text) => compact(text).includes("석차등급"));
    const note = findNearbyItem(page.items, top, (text) => text.trim() === "비고");

    const signature = `${Math.round(top)}|${Math.round(subject.x)}|${Math.round(course.x)}`;
    if (headers.some((h) => `${Math.round(h.top)}|${Math.round(h.subjectX)}|${Math.round(h.courseX)}` === signature)) continue;

    headers.push({
      top,
      kind: rank ? "rankGrade" : "achievement",
      semesterX: semesterLabel.x,
      subjectX: subject.x,
      courseX: course.x,
      creditX: credit.x,
      scoreX: score?.x ?? achievement.x - 45,
      achievementX: achievement.x,
      rankX: rank?.x,
      noteX: note?.x,
    });
  }

  return headers.sort((a, b) => a.top - b.top);
}

function findRegionEnd(lines: TextLine[], headerTop: number, nextHeaderTop: number | undefined, pageHeight: number): number {
  let end = nextHeaderTop != null ? nextHeaderTop - 4 : pageHeight - 20;
  for (const line of lines) {
    if (line.top <= headerTop + 5) continue;
    const c = compact(line.text);
    if (
      c.includes("이수학점합계") ||
      c.includes("과목세부능력및특기사항") ||
      c.includes("8.독서활동상황") ||
      (/20\d{2}년\d{1,2}월\d{1,2}일/.test(c) && c.includes("반") && c.includes("번호") && c.includes("이름"))
    ) {
      end = Math.min(end, line.top - 3);
    }
  }
  return end;
}

function dedupeSemesterMarkers(markers: Array<{ top: number; semester: 1 | 2 }>): Array<{ top: number; semester: 1 | 2 }> {
  const result: Array<{ top: number; semester: 1 | 2 }> = [];
  for (const marker of [...markers].sort((a, b) => a.top - b.top)) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.top - marker.top) <= 4 && last.semester === marker.semester) continue;
    result.push(marker);
  }
  return result;
}

function assignSemester(
  rowTop: number,
  markers: Array<{ top: number; semester: 1 | 2 }>,
  fallback?: 1 | 2
): 1 | 2 | undefined {
  if (markers.length === 0) return fallback;
  if (markers.length === 1) return markers[0].semester;

  const sorted = [...markers].sort((a, b) => a.top - b.top);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    // NEIS PDF의 병합된 학기 셀 숫자는 각 학기 구간의 중앙에 배치된다.
    // 첫 2학기 과목 baseline이 두 마커의 정확한 중간점에 놓이는 문서가 있어,
    // 경계를 약간 위로 당겨 중간점 부근은 뒤 학기로 분류한다.
    const boundary = (sorted[i].top + sorted[i + 1].top) / 2 - SEMESTER_BOUNDARY_BIAS;
    if (rowTop < boundary) return sorted[i].semester;
  }
  return sorted[sorted.length - 1].semester;
}

function itemsInColumn(
  pageItems: PositionedPdfTextItem[],
  rowTop: number,
  xMin: number,
  xMax: number,
  wrap = false
): PositionedPdfTextItem[] {
  const tolerance = wrap ? WRAPPED_CELL_TOLERANCE : ROW_BASELINE_TOLERANCE;
  const candidates = pageItems.filter(
    (item) => item.x >= xMin && item.x < xMax && Math.abs(item.top - rowTop) <= tolerance
  );
  if (!wrap) return candidates.sort((a, b) => a.x - b.x);

  // 보통 과목명은 동일 baseline에 있고, 셀 줄바꿈이 있을 때만 ±13px 범위가 필요하다.
  // 동일 baseline 항목이 충분하면 인접 과목행을 끌어오지 않도록 그것만 사용한다.
  const exact = candidates.filter((item) => Math.abs(item.top - rowTop) <= ROW_BASELINE_TOLERANCE);
  const chosen = exact.length > 0 ? candidates.filter((item) => {
    // 실제 줄바꿈 조각은 정확행의 바로 위/아래 12px에 있다. 14px 이상 떨어진 인접 행은 제외.
    return Math.abs(item.top - rowTop) <= WRAPPED_CELL_TOLERANCE;
  }) : candidates;
  return chosen.sort((a, b) => a.top - b.top || a.x - b.x);
}

function parseAchievementFromItems(items: PositionedPdfTextItem[]): AchievementLevel | undefined {
  for (const item of items) {
    const m = item.text.trim().match(/^([ABCDEPF])(?:\(|$)/);
    if (m) return m[1] as AchievementLevel;
  }
  return undefined;
}

function officialSubjectGroup(rawGroup: string, courseName: string): SubjectGroup {
  const g = compact(rawGroup)
    .replace(/[・·ㆍ]/g, "")
    .replace(/[()]/g, "");
  if (g.startsWith("국어")) return "국어";
  if (g.startsWith("수학")) return "수학";
  if (g.startsWith("영어")) return "영어";
  if (g.startsWith("한국사")) return "한국사";
  if (g.startsWith("사회")) return "사회";
  if (g.startsWith("과학")) return "과학";
  if (g.startsWith("정보")) return "정보";

  // 기술·가정/제2외국어/한문/교양 묶음 속 정보·프로그래밍은 정보 교과군으로 분류한다.
  const inferred = inferSubjectGroup(courseName);
  if (inferred !== "기타") return inferred;
  return "기타";
}

function buildRowRecord(
  page: PositionedPdfPage,
  header: TableHeader,
  rowTop: number,
  credits: number,
  gradeLevel: 1 | 2 | 3,
  semester: 1 | 2,
  regionStart: number,
  regionEnd: number
): ParsedTranscriptRecord | undefined {
  const subjectCourseBoundary = (header.subjectX + header.courseX) / 2;
  const semesterSubjectBoundary = (header.semesterX + header.subjectX) / 2;
  const courseCreditBoundary = header.creditX - 5;
  const achievementRankBoundary = header.rankX != null
    ? (header.achievementX + header.rankX) / 2
    : (header.achievementX + (header.noteX ?? page.width - 50)) / 2;
  const rankNoteBoundary = header.rankX != null
    ? (header.rankX + (header.noteX ?? page.width - 35)) / 2
    : undefined;

  const regionItems = page.items.filter((item) => item.top >= regionStart && item.top < regionEnd);
  const courseItems = itemsInColumn(regionItems, rowTop, subjectCourseBoundary, courseCreditBoundary, true);
  if (courseItems.length === 0) return undefined;
  const courseName = normalizeCellText(courseItems.map((item) => item.text).join(" "));
  if (!courseName || /^\d+$/.test(courseName)) return undefined;

  const subjectItems = itemsInColumn(regionItems, rowTop, semesterSubjectBoundary, subjectCourseBoundary, true);
  const rawGroup = normalizeCellText(subjectItems.map((item) => item.text).join(" "));
  const subjectGroup = officialSubjectGroup(rawGroup, courseName);

  const achievementItems = itemsInColumn(
    regionItems,
    rowTop,
    (header.scoreX + header.achievementX) / 2,
    achievementRankBoundary,
    false
  );
  const achievement = parseAchievementFromItems(achievementItems);

  let rankGrade: number | undefined;
  if (header.rankX != null && rankNoteBoundary != null) {
    const rankItems = itemsInColumn(regionItems, rowTop, achievementRankBoundary, rankNoteBoundary, false);
    for (const item of rankItems) {
      if (/^[1-9]$/.test(item.text.trim())) {
        rankGrade = Number(item.text.trim());
        break;
      }
    }
  }

  let evaluationType: "rankGrade" | "achievement";
  let finalAchievement: AchievementLevel | undefined;
  if (header.kind === "rankGrade" && rankGrade != null) {
    evaluationType = "rankGrade";
  } else if (achievement != null) {
    evaluationType = "achievement";
    finalAchievement = achievement;
    rankGrade = undefined;
  } else {
    // rank table 안에서도 과학탐구실험처럼 석차등급이 비어 있고 성취도만 있는 과목이 있다.
    // 아무 평가값도 찾지 못하면 성적 행으로 확정하지 않는다.
    return undefined;
  }

  const rawLine = `${gradeLevel}학년 ${semester}학기 | ${rawGroup || subjectGroup} | ${courseName} | ${credits} | ${rankGrade ?? finalAchievement ?? ""}`;
  return {
    id: uid(),
    gradeLevel,
    semester,
    subjectGroup,
    courseName,
    credits,
    evaluationType,
    rankGrade,
    achievement: finalAchievement,
    confidence: 0.99,
    rawLine,
  };
}

function parseTable(
  page: PositionedPdfPage,
  header: TableHeader,
  nextHeaderTop: number | undefined,
  gradeLevel: 1 | 2 | 3,
  fallbackSemester?: 1 | 2
): ParsedTranscriptRecord[] {
  const lines = groupLines(page.items);
  const regionStart = header.top + 10;
  const regionEnd = findRegionEnd(lines, header.top, nextHeaderTop, page.height);
  if (regionEnd <= regionStart) return [];

  const semesterSubjectBoundary = (header.semesterX + header.subjectX) / 2;
  const courseCreditBoundary = header.creditX - 5;
  const creditScoreBoundary = (header.creditX + header.scoreX) / 2;

  const markers = dedupeSemesterMarkers(
    page.items
      .filter(
        (item) =>
          item.top >= regionStart &&
          item.top < regionEnd &&
          item.x < semesterSubjectBoundary &&
          /^[12]$/.test(item.text.trim())
      )
      .map((item) => ({ top: item.top, semester: Number(item.text.trim()) as 1 | 2 }))
  );

  const creditItems = page.items
    .filter(
      (item) =>
        item.top >= regionStart &&
        item.top < regionEnd &&
        item.x >= courseCreditBoundary &&
        item.x < creditScoreBoundary &&
        /^\d{1,2}$/.test(item.text.trim()) &&
        Number(item.text.trim()) >= 1 &&
        Number(item.text.trim()) <= 20
    )
    .sort((a, b) => a.top - b.top);

  const seenRowTops: number[] = [];
  const records: ParsedTranscriptRecord[] = [];
  for (const creditItem of creditItems) {
    if (seenRowTops.some((top) => Math.abs(top - creditItem.top) <= 2.0)) continue;
    seenRowTops.push(creditItem.top);
    const semester = assignSemester(creditItem.top, markers, fallbackSemester);
    if (!semester) continue;
    const record = buildRowRecord(
      page,
      header,
      creditItem.top,
      Number(creditItem.text.trim()),
      gradeLevel,
      semester,
      regionStart,
      regionEnd
    );
    if (record) records.push(record);
  }
  return records;
}

function recordKey(record: ParsedTranscriptRecord): string {
  return [
    record.gradeLevel,
    record.semester,
    record.subjectGroup,
    compact(record.courseName),
    record.credits,
    record.rankGrade ?? record.achievement ?? "",
  ].join("|");
}

/**
 * 텍스트가 살아 있는 NEIS/학교생활기록부 PDF 전용 정밀 파서.
 * 일반 본문 텍스트를 추측해서 행으로 만들지 않고, '교과학습발달상황' 안의 실제 표 좌표만 읽는다.
 */
export function parseOfficialTranscriptPositionedPages(pages: PositionedPdfPage[]): PositionedTranscriptParseResult {
  const records: ParsedTranscriptRecord[] = [];
  const warnings: string[] = [];
  let inAcademicSection = false;
  let currentGrade: 1 | 2 | 3 | undefined;
  const fallbackSemesterByGrade = new Map<number, 1 | 2>();

  for (const page of pages) {
    const lines = groupLines(page.items);
    const text = pageText(lines);
    const c = compact(text);

    if (c.includes("교과학습발달상황")) inAcademicSection = true;
    if (!inAcademicSection) continue;

    const gradeMarker = detectGradeMarker(lines);
    if (gradeMarker) currentGrade = gradeMarker;

    const headers = findTableHeaders(page);
    if (currentGrade && headers.length > 0) {
      headers.forEach((header, index) => {
        const tableRecords = parseTable(
          page,
          header,
          headers[index + 1]?.top,
          currentGrade as 1 | 2 | 3,
          fallbackSemesterByGrade.get(currentGrade as number)
        );
        if (tableRecords.length > 0) {
          const lastSemester = tableRecords[tableRecords.length - 1].semester;
          fallbackSemesterByGrade.set(currentGrade as number, lastSemester);
          records.push(...tableRecords);
        }
      });
    }

    if (c.includes("8.독서활동상황")) inAcademicSection = false;
  }

  const deduped: ParsedTranscriptRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const key = recordKey(record);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }

  const rankRecords = deduped.filter((record) => record.evaluationType === "rankGrade");
  const expected = [
    { gradeLevel: 1 as const, semester: 1 as const, label: "1학년 1학기" },
    { gradeLevel: 1 as const, semester: 2 as const, label: "1학년 2학기" },
    { gradeLevel: 2 as const, semester: 1 as const, label: "2학년 1학기" },
    { gradeLevel: 2 as const, semester: 2 as const, label: "2학년 2학기" },
    { gradeLevel: 3 as const, semester: 1 as const, label: "3학년 1학기" },
  ];
  const hasThirdFirst = rankRecords.some((record) => record.gradeLevel === 3 && record.semester === 1);
  if (hasThirdFirst) {
    const missing = expected
      .filter((period) => !rankRecords.some((record) => record.gradeLevel === period.gradeLevel && record.semester === period.semester))
      .map((period) => period.label);
    if (missing.length > 0) warnings.push(`성적표 좌표 분석 결과 누락 학기: ${missing.join(", ")}. 검토표에서 학기 배정을 확인해 주세요.`);
  }

  if (deduped.length === 0) {
    warnings.push("교과학습발달상황 표에서 성적 행을 찾지 못했습니다. 이미지형 PDF라면 OCR 방식으로 다시 처리합니다.");
  }

  return { records: deduped, warnings };
}
