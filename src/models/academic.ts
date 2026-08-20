/**
 * 창원경일고 진학설계 시스템 — 핵심 데이터 모델
 *
 * 원칙:
 *  - 학생 성적의 최소 단위는 "과목 1개 = record 1개"
 *  - 석차등급(rankGrade)과 성취평가(achievement)는 절대 하나의 숫자로 섞지 않는다.
 *  - 학년도를 과목 ID에 넣지 않는다 (과목 정체성 = 교육과정버전 + 과목).
 */

import { getCohortPolicy } from "./cohortPolicy";
import { getCurrentAcademicYear } from "../utils/academicYear";

export type EvaluationType = "rankGrade" | "achievement" | "passFail" | "other";

export type GradeScale = 5 | 9;

export type AchievementLevel = "A" | "B" | "C" | "D" | "E" | "P" | "F";

/** 교과군. 자유 텍스트 허용하되 표준 셋을 우선 제공 */
export type SubjectGroup =
  | "국어"
  | "수학"
  | "영어"
  | "한국사"
  | "사회"
  | "과학"
  | "정보"
  | "기타";

export const SUBJECT_GROUPS: SubjectGroup[] = [
  "국어",
  "수학",
  "영어",
  "한국사",
  "사회",
  "과학",
  "정보",
  "기타",
];

/**
 * 학생 성적 원자료 1건 = 과목 1개.
 * 이 구조는 1·2·3학년이 모두 동일하게 사용한다 (3학년 빠른모드는 courseName을
 * "국어-1" 같은 임시 라벨로 채워 넣는 방식으로 이 구조를 그대로 재사용한다).
 */
export interface AcademicRecord {
  id: string;

  academicYear: number; // 예: 2026
  gradeLevel: 1 | 2 | 3;
  semester: 1 | 2;

  /** 교육과정버전+과목 기준 ID. 정밀입력(과목마스터 연동) 단계에서 사용. MVP 빠른모드에서는 비워도 됨 */
  courseId?: string;

  subjectGroup: string; // SubjectGroup 값 권장, 자유 입력 허용
  courseName: string;

  credits: number; // 이수단위

  evaluationType: EvaluationType;

  /** 5등급제/9등급제 구분. rankGrade 과목에만 의미 있음 */
  gradeScale?: GradeScale;

  /** evaluationType === "rankGrade" 일 때만 사용 */
  rankGrade?: number;

  /** evaluationType === "achievement" 일 때만 사용. P/F는 passFail에 사용 */
  achievement?: AchievementLevel;

  rawScore?: number;
  courseAverage?: number;
  enrollmentCount?: number;

  memo?: string;

  /**
   * 빠른입력(3학년 quick mode)으로 만들어진 레코드인지 표시.
   * 빠른모드는 학년·학기를 실제로 구분해 입력받지 않으므로(교과군 단위 집계),
   * gradeLevel/semester 값을 실제 이수 시점처럼 오인하지 않도록 표시해 둔다.
   * 정밀입력(Phase 3, 학교 편제 연동)에서 만든 레코드는 이 필드가 없거나 "precise"다.
   */
  sourceMode?: "quickAggregate" | "precise";
}

/** 모의고사(수능) 기록. 시계열 확장을 위해 examLabel로 회차 구분 */
export interface MockExamRecord {
  id: string;
  academicYear: number;
  examLabel: string; // "3월", "6월", "9월" 등
  korean?: { grade?: number; percentile?: number };
  math?: { grade?: number; percentile?: number };
  english?: { grade?: number };
  inquiry1?: { grade?: number; percentile?: number };
  inquiry2?: { grade?: number; percentile?: number };
  koreanHistory?: { grade?: number };
  memo?: string;
}

/** 목표등급 설정 1건 */
export interface TargetRecord {
  id: string;
  label: string; // 예: "부산대·경북대 반영교과"
  targetCumulativeGrade: number;
  futureCredits: number;
  subjectGroups?: string[]; // 특정 조합에 대한 목표라면 지정
  memo?: string;
}

/** 3학년 수시 상담 카드 1건 (대학·학과·전형 단위) */
export interface ApplicationRecord {
  id: string;
  universityName: string;
  majorName: string;
  admissionType: string; // 교과/종합/논술 등
  reflectionRatio?: string; // 반영비율
  reflectionSubjects?: string; // 반영교과
  gradeWeightNote?: string; // 학년별 비율
  csatMinimum?: string; // 수능최저

  myConvertedGrade?: number; // 본인 환산 성적 (수동 입력)

  // 3개년 조사값 (학생이 직접 조사해 채워 넣는 항목 — 탐구활동 유지)
  yearlyData?: {
    year: number;
    recruitCount?: number;
    competitionRate?: number;
    additionalAdmit?: number;
    cut70?: number;
    finalCut?: number;
    csatMinimum?: string; // 연도별로 수능최저 기준이 달라질 수 있어 공통 csatMinimum과 별도로 관리
  }[];

  memo?: string;
}

export interface StudentProfile {
  name?: string;
  studentId?: string;
  gradeLevel?: 1 | 2 | 3;
  anonymized?: boolean; // true면 name/studentId 없이 저장 (익명 백업 옵션)
}

/** 최상위 JSON 저장 구조 (schemaVersion 1.0) */
export interface StudentDataFile {
  schemaVersion: string;
  curriculumVersion: string;

  metadata: {
    createdAt: string;
    updatedAt: string;
  };

  profile: StudentProfile;

  academicRecords: AcademicRecord[];
  mockExams: MockExamRecord[];
  targets: TargetRecord[];
  applications: ApplicationRecord[];

  /** 특정 대학/학과에 속하지 않는 전반적인 상담 메모 (자유 기록) */
  notes?: string;
}

export const CURRENT_SCHEMA_VERSION = "1.0";
/** 코호트를 판정할 수 없는 경우의 최후 폴백값. 이 MVP의 1차 대상은 3학년(구체제)이므로
 *  "2015"를 안전한 기본값으로 둔다 — 실제 판정은 항상 getCohortPolicy()를 우선 사용한다. */
export const CURRENT_CURRICULUM_VERSION = "2015";

export function createEmptyDataFile(): StudentDataFile {
  const now = new Date().toISOString();
  // 이 MVP는 3학년 빠른모드 전용이므로 기본 학년을 3으로 두고, 코호트 정책에 따라
  // 교육과정·등급체계를 자동 판정한다 (검수 지적 반영 — P0: 전역 상수가 아니라
  // "이 학생이 언제 입학했는가"로 결정되어야 하는 값). 시간이 지나 "현재 3학년"의
  // 실제 코호트가 바뀌면(예: 2027학년도부터 3학년도 5등급제 세대) 이 함수가 자동으로
  // 올바른 값을 계산한다.
  const currentYear = getCurrentAcademicYear();
  const policy = getCohortPolicy(currentYear, 3);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    curriculumVersion: policy.curriculumVersion,
    metadata: { createdAt: now, updatedAt: now },
    profile: { gradeLevel: 3 },
    academicRecords: [],
    mockExams: [],
    targets: [],
    applications: [],
  };
}

let idCounter = 0;
/** 브라우저 crypto.randomUUID가 없는 환경(구형 브라우저) 대비 폴백 포함 */
export function generateId(prefix = "rec"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}
