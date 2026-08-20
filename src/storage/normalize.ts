/**
 * 마이그레이션 이후 실행되는 정규화 단계.
 *
 * `JSON.parse` + `migrateToCurrent`는 스키마 *버전*은 맞춰주지만, 필드 자체가
 * 아예 없는 손상되거나 불완전한 파일까지 안전하게 만들어주지는 않는다.
 * (검수 지적: `as StudentDataFile` 캐스팅은 런타임 검증이 아니다.)
 *
 * 이 함수는 화면 코드가 항상 `state.profile.name`, `state.metadata.updatedAt`
 * 같은 경로에 안전하게 접근할 수 있도록 최소 구조를 보장한다.
 * 원본 객체는 변경하지 않는다.
 */

import type {
  StudentDataFile,
  AcademicRecord,
  MockExamRecord,
  ApplicationRecord,
  TargetRecord,
  StudentProfile,
} from "../models/academic";
import { CURRENT_SCHEMA_VERSION, CURRENT_CURRICULUM_VERSION } from "../models/academic";
import { getCohortPolicy } from "../models/cohortPolicy";
import { getCurrentAcademicYear } from "../utils/academicYear";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function normalizeProfile(v: unknown): StudentProfile {
  if (!isPlainObject(v)) return {};
  const p = v as Partial<StudentProfile>;
  return {
    name: typeof p.name === "string" ? p.name : undefined,
    studentId: typeof p.studentId === "string" ? p.studentId : undefined,
    gradeLevel: p.gradeLevel === 1 || p.gradeLevel === 2 || p.gradeLevel === 3 ? p.gradeLevel : undefined,
    anonymized: typeof p.anonymized === "boolean" ? p.anonymized : undefined,
  };
}

/** 유효하지 않은 개별 레코드는 버리지 않고 최소 필드를 보정해 보존한다 (원자료 손실 방지). */
function normalizeAcademicRecord(r: unknown, index: number): AcademicRecord | null {
  if (!isPlainObject(r)) return null;
  const rec = r as Partial<AcademicRecord>;
  const evaluationType =
    rec.evaluationType === "rankGrade" ||
    rec.evaluationType === "achievement" ||
    rec.evaluationType === "passFail" ||
    rec.evaluationType === "other"
      ? rec.evaluationType
      : "other"; // 알 수 없는 유형은 임의로 rankGrade로 바꾸지 않고 "other"로 보존
  return {
    id: typeof rec.id === "string" ? rec.id : `rec_normalized_${index}`,
    academicYear: typeof rec.academicYear === "number" ? rec.academicYear : getCurrentAcademicYear(),
    gradeLevel: rec.gradeLevel === 1 || rec.gradeLevel === 2 || rec.gradeLevel === 3 ? rec.gradeLevel : 1,
    semester: rec.semester === 1 || rec.semester === 2 ? rec.semester : 1,
    courseId: typeof rec.courseId === "string" ? rec.courseId : undefined,
    subjectGroup: typeof rec.subjectGroup === "string" ? rec.subjectGroup : "기타",
    courseName: typeof rec.courseName === "string" ? rec.courseName : "이름없음",
    credits: typeof rec.credits === "number" && isFinite(rec.credits) ? rec.credits : 0,
    evaluationType,
    gradeScale: rec.gradeScale === 5 || rec.gradeScale === 9 ? rec.gradeScale : undefined,
    rankGrade: typeof rec.rankGrade === "number" ? rec.rankGrade : undefined,
    achievement:
      rec.achievement === "A" || rec.achievement === "B" || rec.achievement === "C" || rec.achievement === "D" || rec.achievement === "E" || rec.achievement === "P" || rec.achievement === "F"
        ? rec.achievement
        : undefined,
    rawScore: typeof rec.rawScore === "number" ? rec.rawScore : undefined,
    courseAverage: typeof rec.courseAverage === "number" ? rec.courseAverage : undefined,
    enrollmentCount: typeof rec.enrollmentCount === "number" ? rec.enrollmentCount : undefined,
    memo: typeof rec.memo === "string" ? rec.memo : undefined,
    sourceMode:
      rec.sourceMode === "quickAggregate" || rec.sourceMode === "quickSemester" || rec.sourceMode === "precise"
        ? rec.sourceMode
        : undefined,
  };
}

/** 모의고사 영역 점수({grade, percentile}) 하나를 안전하게 정규화한다.
 *  객체가 아니거나 필드가 손상되어 있으면 undefined로 처리한다 (검수 지적:
 *  이전에는 rec.korean 등을 검증 없이 그대로 통과시켜, 손상된 중첩 객체가
 *  UI에서 y.grade 등을 읽을 때 문제를 일으킬 수 있었다). */
function normalizeScoreField(v: unknown): { grade?: number; percentile?: number } | undefined {
  if (!isPlainObject(v)) return undefined;
  const grade = typeof v.grade === "number" && Number.isFinite(v.grade) ? v.grade : undefined;
  const percentile = typeof v.percentile === "number" && Number.isFinite(v.percentile) ? v.percentile : undefined;
  if (grade == null && percentile == null) return undefined;
  return { grade, percentile };
}

function normalizeMockExam(r: unknown, index: number): MockExamRecord | null {
  if (!isPlainObject(r)) return null;
  const rec = r as Partial<MockExamRecord>;
  return {
    id: typeof rec.id === "string" ? rec.id : `mock_normalized_${index}`,
    academicYear: typeof rec.academicYear === "number" ? rec.academicYear : getCurrentAcademicYear(),
    examLabel: typeof rec.examLabel === "string" ? rec.examLabel : "회차미상",
    korean: normalizeScoreField(rec.korean),
    math: normalizeScoreField(rec.math),
    english: normalizeScoreField(rec.english),
    inquiry1: normalizeScoreField(rec.inquiry1),
    inquiry2: normalizeScoreField(rec.inquiry2),
    koreanHistory: normalizeScoreField(rec.koreanHistory),
    memo: typeof rec.memo === "string" ? rec.memo : undefined,
  };
}

/** 대학 조사의 연도별 자료 배열 안의 개별 항목을 정규화한다. 배열 자체가 아니라
 *  "배열 안의 각 원소"까지 검증하지 않으면, 손상된 항목(null 등)이 그대로 통과해
 *  이후 UI가 y.year 등을 읽을 때 문제가 생길 수 있다 (검수 지적 반영). */
function normalizeYearlyDataArray(v: unknown): NonNullable<ApplicationRecord["yearlyData"]> {
  if (!Array.isArray(v)) return [];
  const result: NonNullable<ApplicationRecord["yearlyData"]> = [];
  for (const item of v) {
    if (!isPlainObject(item)) continue; // null·문자열 등 잘못된 원소는 조용히 걸러낸다
    const year = typeof item.year === "number" && Number.isFinite(item.year) ? item.year : undefined;
    if (year == null) continue; // 연도가 없는 항목은 의미가 없으므로 제외
    result.push({
      year,
      recruitCount: typeof item.recruitCount === "number" ? item.recruitCount : undefined,
      competitionRate: typeof item.competitionRate === "number" ? item.competitionRate : undefined,
      additionalAdmit: typeof item.additionalAdmit === "number" ? item.additionalAdmit : undefined,
      cut70: typeof item.cut70 === "number" ? item.cut70 : undefined,
      finalCut: typeof item.finalCut === "number" ? item.finalCut : undefined,
      csatMinimum: typeof item.csatMinimum === "string" ? item.csatMinimum : undefined,
    });
  }
  return result;
}

function normalizeApplication(r: unknown, index: number): ApplicationRecord | null {
  if (!isPlainObject(r)) return null;
  const rec = r as Partial<ApplicationRecord>;
  return {
    id: typeof rec.id === "string" ? rec.id : `app_normalized_${index}`,
    universityName: typeof rec.universityName === "string" ? rec.universityName : "대학명 없음",
    majorName: typeof rec.majorName === "string" ? rec.majorName : "학과명 없음",
    admissionType: typeof rec.admissionType === "string" ? rec.admissionType : "교과",
    reflectionRatio: typeof rec.reflectionRatio === "string" ? rec.reflectionRatio : undefined,
    reflectionSubjects: typeof rec.reflectionSubjects === "string" ? rec.reflectionSubjects : undefined,
    gradeWeightNote: typeof rec.gradeWeightNote === "string" ? rec.gradeWeightNote : undefined,
    csatMinimum: typeof rec.csatMinimum === "string" ? rec.csatMinimum : undefined,
    myConvertedGrade: typeof rec.myConvertedGrade === "number" ? rec.myConvertedGrade : undefined,
    yearlyData: normalizeYearlyDataArray(rec.yearlyData),
    memo: typeof rec.memo === "string" ? rec.memo : undefined,
  };
}

function normalizeTarget(r: unknown, index: number): TargetRecord | null {
  if (!isPlainObject(r)) return null;
  const rec = r as Partial<TargetRecord>;
  return {
    id: typeof rec.id === "string" ? rec.id : `target_normalized_${index}`,
    label: typeof rec.label === "string" ? rec.label : "목표",
    targetCumulativeGrade: typeof rec.targetCumulativeGrade === "number" ? rec.targetCumulativeGrade : 0,
    futureCredits: typeof rec.futureCredits === "number" ? rec.futureCredits : 0,
    subjectGroups: Array.isArray(rec.subjectGroups) ? rec.subjectGroups : undefined,
    memo: typeof rec.memo === "string" ? rec.memo : undefined,
  };
}

/**
 * 마이그레이션된 데이터를 받아, 앱 코드가 항상 안전하게 접근할 수 있는
 * 완전한 구조로 보정한다. 원본은 변경하지 않는다.
 */
export function normalizeStudentDataFile(data: unknown): StudentDataFile {
  const d = isPlainObject(data) ? data : {};
  const now = new Date().toISOString();

  const metadataInput = isPlainObject(d.metadata) ? d.metadata : {};
  const profile = normalizeProfile(d.profile);

  // curriculumVersion이 파일에 없으면, 가능하면 학생의 학년(코호트)으로부터 추론한다
  // (검수 지적 반영: "현재 연도" 하나로 고정된 상수보다 "이 학생이 언제 입학했는가"가
  // 더 정확한 근거다). 학년 정보가 없으면 최후 폴백으로 CURRENT_CURRICULUM_VERSION을 쓴다.
  const inferredCurriculumVersion = (): string => {
    if (typeof d.curriculumVersion === "string") return d.curriculumVersion;
    if (profile.gradeLevel != null) {
      return getCohortPolicy(getCurrentAcademicYear(), profile.gradeLevel).curriculumVersion;
    }
    return CURRENT_CURRICULUM_VERSION;
  };

  return {
    schemaVersion: typeof d.schemaVersion === "string" ? d.schemaVersion : CURRENT_SCHEMA_VERSION,
    curriculumVersion: inferredCurriculumVersion(),
    metadata: {
      createdAt: typeof metadataInput.createdAt === "string" ? metadataInput.createdAt : now,
      updatedAt: typeof metadataInput.updatedAt === "string" ? metadataInput.updatedAt : now,
    },
    profile,
    academicRecords: asArray<unknown>(d.academicRecords)
      .map((r, i) => normalizeAcademicRecord(r, i))
      .filter((r): r is AcademicRecord => r !== null),
    mockExams: asArray<unknown>(d.mockExams)
      .map((r, i) => normalizeMockExam(r, i))
      .filter((r): r is MockExamRecord => r !== null),
    targets: asArray<unknown>(d.targets)
      .map((r, i) => normalizeTarget(r, i))
      .filter((r): r is TargetRecord => r !== null),
    applications: asArray<unknown>(d.applications)
      .map((r, i) => normalizeApplication(r, i))
      .filter((r): r is ApplicationRecord => r !== null),
    notes: typeof d.notes === "string" ? d.notes : undefined,
  };
}
