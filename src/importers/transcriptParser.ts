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

const SUBJECT_KEYWORDS: Array<[SubjectGroup, RegExp]> = [
  ["국어", /(국어|공통국어|문학|독서|화법|작문|언어와\s*매체|고전읽기)/],
  ["수학", /(수학|공통수학|미적분|확률과\s*통계|기하|경제수학|인공지능\s*수학)/],
  ["영어", /(영어|English|영미|영어권)/i],
  ["한국사", /(한국사)/],
  ["사회", /(통합사회|사회문화|사회·문화|정치와\s*법|법과\s*정치|경제|한국지리|세계지리|생활과\s*윤리|윤리와\s*사상|동아시아사|세계사|여행지리|사회문제)/],
  ["과학", /(통합과학|과학탐구|물리|화학|생명과학|지구과학|과학사|융합과학|생활과\s*과학)/],
  ["정보", /(정보|프로그래밍|인공지능|컴퓨터|데이터과학|소프트웨어)/],
];

const HEADER_WORDS = new Set([
  "교과", "과목", "과목명", "단위수", "단위", "원점수", "과목평균", "표준편차",
  "성취도", "수강자수", "석차등급", "등급", "비고",
]);

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

function detectSemesterContext(line: string): { gradeLevel?: 1 | 2 | 3; semester?: 1 | 2 } {
  const both = line.match(/([123])\s*학년\s*([12])\s*학기/);
  if (both) return { gradeLevel: Number(both[1]) as 1 | 2 | 3, semester: Number(both[2]) as 1 | 2 };
  const short = line.match(/(?:^|\s)([123])\s*[-/]\s*([12])(?:\s|$)/);
  if (short) return { gradeLevel: Number(short[1]) as 1 | 2 | 3, semester: Number(short[2]) as 1 | 2 };
  const grade = line.match(/([123])\s*학년/);
  const semester = line.match(/([12])\s*학기/);
  return {
    gradeLevel: grade ? (Number(grade[1]) as 1 | 2 | 3) : undefined,
    semester: semester ? (Number(semester[1]) as 1 | 2) : undefined,
  };
}

export function inferSubjectGroup(courseName: string, fullLine = ""): SubjectGroup {
  const haystack = `${courseName} ${fullLine}`;
  for (const [group, re] of SUBJECT_KEYWORDS) if (re.test(haystack)) return group;
  return "기타";
}

function isLikelyHeader(line: string): boolean {
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 2) return true;
  const headerHits = [...HEADER_WORDS].filter((w) => compact.includes(w.replace(/\s+/g, ""))).length;
  return headerHits >= 3;
}

function tokenize(line: string): string[] {
  const tabTokens = line.split(/\t+/).map((s) => s.trim()).filter(Boolean);
  if (tabTokens.length >= 3) return tabTokens;
  return line.split(/\s{2,}|\s+/).map((s) => s.trim()).filter(Boolean);
}

function parseNumeric(token: string): number | undefined {
  const trimmed = token.trim().replace(/,/g, "");
  // 과목명 안의 숫자(예: 공통국어1, 수학Ⅱ)를 숫자 열로 오인하지 않는다.
  const m = trimmed.match(/^(-?\d+(?:\.\d+)?)(?:단위|등급|점)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function cleanCourseName(tokens: string[], subjectGroup: SubjectGroup): string {
  const kept = tokens.filter((token) => {
    const t = token.trim();
    if (!t || HEADER_WORDS.has(t) || t === subjectGroup) return false;
    if (/^[123]학년$/.test(t) || /^[12]학기$/.test(t) || /^[123][-\/][12]$/.test(t)) return false;
    return true;
  });
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

export function parseTranscriptText(text: string): TranscriptParseResult {
  const lines = normalizeText(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const records: ParsedTranscriptRecord[] = [];
  const warnings: string[] = [];
  let currentGrade: 1 | 2 | 3 | undefined;
  let currentSemester: 1 | 2 | undefined;

  for (const line of lines) {
    const context = detectSemesterContext(line);
    if (context.gradeLevel) currentGrade = context.gradeLevel;
    if (context.semester) currentSemester = context.semester;
    if (isLikelyHeader(line)) continue;

    const tokens = tokenize(line);
    if (tokens.length < 2) continue;
    let gradeLevel = currentGrade;
    let semester = currentSemester;
    let tokenStart = 0;
    if (/^[123]$/.test(tokens[0] ?? "") && /^[12]$/.test(tokens[1] ?? "")) {
      gradeLevel = Number(tokens[0]) as 1 | 2 | 3;
      semester = Number(tokens[1]) as 1 | 2;
      tokenStart = 2;
    }

    const body = tokens.slice(tokenStart);
    let achievement: AchievementLevel | undefined;
    for (let i = body.length - 1; i >= 0; i--) {
      if (/^[ABCDE]$/.test(body[i])) { achievement = body[i] as AchievementLevel; break; }
    }

    const numericTokens = body
      .map((token, idx) => ({ idx, value: parseNumeric(token) }))
      .filter((x): x is { idx: number; value: number } => x.value != null);
    if (numericTokens.length === 0) continue;

    const creditCandidate = numericTokens.find((x) => Number.isInteger(x.value) && x.value >= 1 && x.value <= 20);
    if (!creditCandidate) continue;
    const gradeCandidate = [...numericTokens].reverse().find(
      (x) => x.idx !== creditCandidate.idx && Number.isInteger(x.value) && x.value >= 1 && x.value <= 9
    );

    const rawNameTokens = body.slice(0, creditCandidate.idx);
    if (rawNameTokens.length === 0) continue;
    const provisionalName = rawNameTokens.join(" ");
    const subjectGroup = inferSubjectGroup(provisionalName, line);
    const courseName = cleanCourseName(rawNameTokens, subjectGroup);
    if (!courseName) continue;

    // 성취도(A~E)와 석차등급이 함께 있는 행은 석차등급을 우선 사용한다.
    // 성취평가 전용 과목처럼 석차등급이 없을 때만 achievement로 처리한다.
    const evaluationType: "rankGrade" | "achievement" = gradeCandidate ? "rankGrade" : achievement ? "achievement" : "rankGrade";
    const rankGrade = evaluationType === "rankGrade" ? gradeCandidate?.value : undefined;
    if (evaluationType === "rankGrade" && rankGrade == null) continue;
    if (evaluationType === "rankGrade") achievement = undefined;

    let confidence = 0.45;
    if (gradeLevel && semester) confidence += 0.2;
    if (subjectGroup !== "기타") confidence += 0.15;
    if (creditCandidate.value <= 8) confidence += 0.1;
    if (rankGrade != null || achievement != null) confidence += 0.1;
    if (line.includes("\t")) confidence += 0.05;

    records.push({
      id: uid(),
      gradeLevel: gradeLevel ?? 3,
      semester: semester ?? 1,
      subjectGroup,
      courseName,
      credits: creditCandidate.value,
      evaluationType,
      rankGrade,
      achievement,
      confidence: Math.min(0.99, confidence),
      rawLine: line,
    });
  }

  if (records.length === 0) warnings.push("성적 행을 자동으로 찾지 못했습니다. 문서 양식에 맞춘 파서 보정이 필요할 수 있습니다.");
  if (records.some((r) => r.subjectGroup === "기타")) warnings.push("교과군을 자동 판별하지 못한 과목이 있습니다. 검토표에서 교과군을 확인하세요.");
  return { records, warnings };
}
