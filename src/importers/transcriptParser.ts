import type { AchievementLevel, SubjectGroup } from "../models/academic";

export interface ParsedTranscriptRecord {
  id: string;
  gradeLevel: 1 | 2 | 3;
  semester: 1 | 2;
  subjectGroup: SubjectGroup;
  courseName: string;
  credits: number;
  evaluationType: "rankGrade" | "achievement";
  rankGrade?: number;
  achievement?: AchievementLevel;
  confidence: number;
  rawLine: string;
}

export interface TranscriptParseResult {
  records: ParsedTranscriptRecord[];
  warnings: string[];
}

type TableKind = "rankGrade" | "achievement";

const SUBJECT_KEYWORDS: Array<[SubjectGroup, RegExp]> = [
  // 과목명 맨 앞을 중심으로 판정한다. '중국어/외국어' 안의 '국어'를 국어 교과로
  // 오인하던 부분을 막기 위해 국어/영어 등의 단순 부분문자열 매칭을 사용하지 않는다.
  ["국어", /^(?:국어|공통국어|문학|독서|화법|작문|언어와\s*매체|심화\s*국어|고전읽기)/],
  ["수학", /^(?:수학|공통수학|미적분|확률과\s*통계|기하|경제수학|인공지능\s*수학|심화\s*수학)/],
  ["영어", /^(?:영어|English|영미|영어권|심화\s*영어)/i],
  ["한국사", /^한국사/],
  ["사회", /^(?:통합사회|사회문화|사회·문화|정치와\s*법|법과\s*정치|경제|한국지리|세계지리|생활과\s*윤리|윤리와\s*사상|동아시아사|세계사|여행지리|사회문제)/],
  ["과학", /^(?:통합과학|과학탐구|물리|화학|생명과학|지구과학|과학사|융합과학|생활과\s*과학)/],
  ["정보", /^(?:정보|프로그래밍|인공지능|컴퓨터|데이터과학|소프트웨어)/],
];

const HEADER_WORDS = new Set([
  "교과", "과목", "과목명", "학점수", "단위수", "단위", "원점수", "과목평균", "표준편차",
  "성취도", "수강자수", "석차등급", "등급", "비고", "성취도별", "분포비율",
]);

const BROAD_GROUP_PREFIX = /^(국어|수학|영어|한국사|과학|사회|기술[・·ㆍ]?가정|기술|가정|제2외국어|외국어|한문|교양|예술|체육)/;
const BROAD_GROUP_CONTINUATION = /^(포함\)?|외국어\/한문\/교|외국어\/한문|양|제2외국어\/한문\/교양)$/;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `parsed_${crypto.randomUUID()}`;
  return `parsed_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[｜|]/g, "\t")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/\u00a0/g, " ");
}

function compact(line: string): string {
  return line.replace(/\s+/g, "");
}

function stripInjectedSemester(line: string): { line: string; semester?: 1 | 2 } {
  const m = line.match(/^\[\[SEM:([12])\]\]\s*(.*)$/);
  if (!m) return { line };
  return { line: m[2].trim(), semester: Number(m[1]) as 1 | 2 };
}

function isAcademicSectionStart(line: string): boolean {
  return compact(line).includes("교과학습발달상황");
}

function isAcademicSectionEnd(line: string): boolean {
  const c = compact(line);
  return c.includes("8.독서활동상황") || c.includes("8.독서활동") || c === "독서활동상황";
}

function extractGradeMarker(line: string): 1 | 2 | 3 | undefined {
  const c = compact(line);
  const bracket = c.match(/^\[([123])학년\]$/);
  if (bracket) return Number(bracket[1]) as 1 | 2 | 3;
  const plain = c.match(/^([123])학년$/);
  return plain ? (Number(plain[1]) as 1 | 2 | 3) : undefined;
}

function isTableHeader(line: string): boolean {
  const c = compact(line);
  return c.includes("학기") && c.includes("교과") && c.includes("과목") && (c.includes("학점수") || c.includes("단위수"));
}

function isTableStop(line: string): boolean {
  const c = compact(line);
  return c.includes("이수학점합계") || c.includes("과목세부능력및특기사항");
}

function isPageFooter(line: string): boolean {
  const c = compact(line);
  return /20\d{2}년\d{1,2}월\d{1,2}일/.test(c) && c.includes("반") && c.includes("번호") && c.includes("이름");
}

function tokenize(line: string): string[] {
  const tabTokens = line.split(/\t+/).map((s) => s.trim()).filter(Boolean);
  if (tabTokens.length >= 2) return tabTokens;
  return line.split(/\s{2,}|\s+/).map((s) => s.trim()).filter(Boolean);
}

function parseNumeric(token: string): number | undefined {
  const trimmed = token.trim().replace(/,/g, "");
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(?:학점|단위|등급|점)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function parseAchievement(token: string): AchievementLevel | undefined {
  const m = token.trim().match(/^([ABCDE])(?:\(|$)/);
  return m ? (m[1] as AchievementLevel) : undefined;
}

export function inferSubjectGroup(courseName: string, _fullLine = ""): SubjectGroup {
  const normalized = courseName.replace(/\s+/g, " ").trim();
  for (const [group, re] of SUBJECT_KEYWORDS) if (re.test(normalized)) return group;
  return "기타";
}

function isBroadGroupDescriptor(token: string): boolean {
  const t = token.replace(/\s+/g, "");
  return BROAD_GROUP_PREFIX.test(t) || BROAD_GROUP_CONTINUATION.test(t);
}

function cleanCourseName(tokens: string[]): string {
  const kept = tokens
    .map((token) => token.trim())
    .filter((t) => {
      if (!t || HEADER_WORDS.has(t)) return false;
      if (/^[123]학년$/.test(t) || /^[12]학기$/.test(t) || /^[123][-\/][12]$/.test(t)) return false;
      return true;
    });

  while (kept.length > 1 && isBroadGroupDescriptor(kept[0])) kept.shift();
  if (kept.length >= 2 && kept[0].replace(/\s+/g, "") === kept[1].replace(/\s+/g, "")) kept.shift();

  return kept.join(" ").replace(/\s+/g, " ").trim();
}

function parseRow(
  line: string,
  gradeLevel: 1 | 2 | 3 | undefined,
  semester: 1 | 2 | undefined,
  preferredKind: TableKind
): ParsedTranscriptRecord | undefined {
  if (!gradeLevel || !semester) return undefined;

  const tokens = tokenize(line);
  if (tokens.length < 2) return undefined;

  let tokenStart = 0;
  if (/^[123]$/.test(tokens[0] ?? "") && /^[12]$/.test(tokens[1] ?? "") && tokens.length >= 4) {
    gradeLevel = Number(tokens[0]) as 1 | 2 | 3;
    semester = Number(tokens[1]) as 1 | 2;
    tokenStart = 2;
  } else if (/^[12]$/.test(tokens[0] ?? "") && tokens.length >= 3) {
    semester = Number(tokens[0]) as 1 | 2;
    tokenStart = 1;
  }

  const body = tokens.slice(tokenStart);
  const numericTokens = body
    .map((token, idx) => ({ idx, value: parseNumeric(token) }))
    .filter((x): x is { idx: number; value: number } => x.value != null);

  if (numericTokens.length === 0) return undefined;
  const creditCandidate = numericTokens.find((x) => Number.isInteger(x.value) && x.value >= 1 && x.value <= 20);
  if (!creditCandidate) return undefined;

  const rawNameTokens = body.slice(0, creditCandidate.idx);
  const courseName = cleanCourseName(rawNameTokens);
  if (!courseName) return undefined;

  const subjectGroup = inferSubjectGroup(courseName, line);
  const achievement = body.map(parseAchievement).find((x): x is AchievementLevel => x != null);
  const rankCandidate = [...numericTokens].reverse().find(
    (x) => x.idx !== creditCandidate.idx && Number.isInteger(x.value) && x.value >= 1 && x.value <= 9
  );

  let evaluationType: "rankGrade" | "achievement";
  let rankGrade: number | undefined;
  let finalAchievement: AchievementLevel | undefined;

  if (preferredKind === "rankGrade" && rankCandidate) {
    evaluationType = "rankGrade";
    rankGrade = rankCandidate.value;
  } else if (achievement) {
    evaluationType = "achievement";
    finalAchievement = achievement;
  } else if (rankCandidate) {
    evaluationType = "rankGrade";
    rankGrade = rankCandidate.value;
  } else {
    return undefined;
  }

  let confidence = 0.55;
  if (subjectGroup !== "기타") confidence += 0.15;
  if (creditCandidate.value <= 8) confidence += 0.1;
  if (rankGrade != null || finalAchievement != null) confidence += 0.1;
  if (line.includes("\t")) confidence += 0.05;

  return {
    id: uid(),
    gradeLevel,
    semester,
    subjectGroup,
    courseName,
    credits: creditCandidate.value,
    evaluationType,
    rankGrade,
    achievement: finalAchievement,
    confidence: Math.min(0.99, confidence),
    rawLine: line,
  };
}

function parseLooseTranscript(lines: string[]): ParsedTranscriptRecord[] {
  const records: ParsedTranscriptRecord[] = [];
  let currentGrade: 1 | 2 | 3 | undefined;
  let currentSemester: 1 | 2 | undefined;

  for (const line of lines) {
    const both = line.match(/([123])\s*학년\s*([12])\s*학기/);
    if (both) {
      currentGrade = Number(both[1]) as 1 | 2 | 3;
      currentSemester = Number(both[2]) as 1 | 2;
      continue;
    }
    const gradeOnly = extractGradeMarker(line);
    if (gradeOnly) {
      currentGrade = gradeOnly;
      continue;
    }

    const tokens = tokenize(line);
    if (/^[123]$/.test(tokens[0] ?? "") && /^[12]$/.test(tokens[1] ?? "")) {
      currentGrade = Number(tokens[0]) as 1 | 2 | 3;
      currentSemester = Number(tokens[1]) as 1 | 2;
    } else if (currentGrade && /^[12]$/.test(tokens[0] ?? "") && tokens.length >= 3) {
      currentSemester = Number(tokens[0]) as 1 | 2;
    }

    const row = parseRow(line, currentGrade, currentSemester, "rankGrade");
    if (row) records.push(row);
  }
  return records;
}

function parseSchoolRecordAcademicSection(lines: string[]): ParsedTranscriptRecord[] {
  const records: ParsedTranscriptRecord[] = [];
  let inAcademicSection = false;
  let currentGrade: 1 | 2 | 3 | undefined;
  let currentSemester: 1 | 2 | undefined;
  let sectionKind: TableKind = "rankGrade";
  let tableActive = false;

  for (const rawLine of lines) {
    const injected = stripInjectedSemester(rawLine);
    const line = injected.line;

    if (!inAcademicSection) {
      if (isAcademicSectionStart(line)) inAcademicSection = true;
      continue;
    }
    if (isAcademicSectionEnd(line)) break;

    const gradeMarker = extractGradeMarker(line);
    if (gradeMarker) {
      currentGrade = gradeMarker;
      currentSemester = undefined;
      sectionKind = "rankGrade";
      tableActive = false;
      continue;
    }

    const c = compact(line);
    if (c.includes("<진로선택과목>") || c === "진로선택과목") {
      sectionKind = "achievement";
      currentSemester = undefined;
      tableActive = false;
      continue;
    }
    if (c.includes("<체육ㆍ예술>") || c.includes("<체육·예술>") || c === "체육ㆍ예술" || c === "체육·예술") {
      sectionKind = "achievement";
      currentSemester = undefined;
      tableActive = false;
      continue;
    }

    if (isPageFooter(line)) {
      tableActive = false;
      continue;
    }
    if (isTableStop(line)) {
      tableActive = false;
      continue;
    }
    if (isTableHeader(line)) {
      tableActive = true;
      continue;
    }
    if (!tableActive) continue;

    if (injected.semester) currentSemester = injected.semester;

    if (/^[12]$/.test(c)) {
      currentSemester = Number(c) as 1 | 2;
      continue;
    }

    const tokens = tokenize(line);
    if (/^[12]$/.test(tokens[0] ?? "") && tokens.length >= 3) {
      currentSemester = Number(tokens[0]) as 1 | 2;
    }

    const row = parseRow(line, currentGrade, currentSemester, sectionKind);
    if (row) records.push(row);
  }

  return records;
}

export function parseTranscriptText(text: string): TranscriptParseResult {
  const lines = normalizeText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const warnings: string[] = [];
  const hasOfficialAcademicSection = lines.some(isAcademicSectionStart);
  const records = hasOfficialAcademicSection
    ? parseSchoolRecordAcademicSection(lines)
    : parseLooseTranscript(lines);

  if (records.length === 0) {
    warnings.push("성적 행을 자동으로 찾지 못했습니다. 문서의 '교과학습발달상황' 표 형식을 확인해 주세요.");
  }
  if (records.some((r) => r.subjectGroup === "기타")) {
    warnings.push("교과군을 자동 판별하지 못한 과목이 있습니다. 검토표에서 교과군을 확인하세요.");
  }

  const expectedFive = [
    { gradeLevel: 1 as const, semester: 1 as const, label: "1학년 1학기" },
    { gradeLevel: 1 as const, semester: 2 as const, label: "1학년 2학기" },
    { gradeLevel: 2 as const, semester: 1 as const, label: "2학년 1학기" },
    { gradeLevel: 2 as const, semester: 2 as const, label: "2학년 2학기" },
    { gradeLevel: 3 as const, semester: 1 as const, label: "3학년 1학기" },
  ];
  const hasThirdFirst = records.some((r) => r.gradeLevel === 3 && r.semester === 1);
  if (hasThirdFirst) {
    const missing = expectedFive
      .filter((s) => !records.some((r) => r.gradeLevel === s.gradeLevel && r.semester === s.semester))
      .map((s) => s.label);
    if (missing.length > 0) {
      warnings.push(`5개 학기 중 ${missing.join(", ")} 성적이 인식되지 않았습니다. 자동추출 검토표의 학년·학기 배정을 확인하세요.`);
    }
  }

  return { records, warnings };
}
