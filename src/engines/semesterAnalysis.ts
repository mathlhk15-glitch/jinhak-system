import type { AcademicRecord } from "../models/academic";
import { computeCombination, computeWeightedAverage, type WeightedAverageResult } from "./gradeEngine";

export interface SemesterDef {
  key: string;
  label: string;
  gradeLevel: 1 | 2 | 3;
  semester: 1 | 2;
}

export const COUNSELING_SEMESTERS: SemesterDef[] = [
  { key: "1-1", label: "1학년 1학기", gradeLevel: 1, semester: 1 },
  { key: "1-2", label: "1학년 2학기", gradeLevel: 1, semester: 2 },
  { key: "2-1", label: "2학년 1학기", gradeLevel: 2, semester: 1 },
  { key: "2-2", label: "2학년 2학기", gradeLevel: 2, semester: 2 },
  { key: "3-1", label: "3학년 1학기", gradeLevel: 3, semester: 1 },
];

export interface SemesterCombinationResult {
  semester: SemesterDef | null;
  label: string;
  records: AcademicRecord[];
  combinations: Record<string, WeightedAverageResult>;
  allSubjects: WeightedAverageResult;
}

/**
 * 학기 정보가 실제로 있는 원자료만 학기별 분석에 사용한다.
 * - precise: PDF/사진/정밀입력 원자료
 * - quickSemester: 수동 입력에서 학기를 지정한 원자료
 * - quickAggregate: 학기 구분 없는 누적 집계이므로 제외
 */
export function getSemesterAwareRecords(records: AcademicRecord[]): AcademicRecord[] {
  return records.filter((r) => r.sourceMode === "precise" || r.sourceMode === "quickSemester");
}

export function computeSemesterCombinationMatrix(
  records: AcademicRecord[],
  combinations: { id: string; subjectGroups: string[] }[]
): SemesterCombinationResult[] {
  const semesterAware = getSemesterAwareRecords(records);

  const rows: SemesterCombinationResult[] = COUNSELING_SEMESTERS.map((semester): SemesterCombinationResult => {
    const semesterRecords = semesterAware.filter(
      (r) => r.gradeLevel === semester.gradeLevel && r.semester === semester.semester
    );
    const comboResults: Record<string, WeightedAverageResult> = {};
    for (const combo of combinations) {
      comboResults[combo.id] = computeCombination(semesterRecords, combo.subjectGroups);
    }
    return {
      semester,
      label: semester.label,
      records: semesterRecords,
      combinations: comboResults,
      allSubjects: computeWeightedAverage(semesterRecords),
    };
  });

  const totalComboResults: Record<string, WeightedAverageResult> = {};
  for (const combo of combinations) {
    totalComboResults[combo.id] = computeCombination(semesterAware, combo.subjectGroups);
  }
  rows.push({
    semester: null,
    label: "전체(5개 학기 단위수 가중)",
    records: semesterAware,
    combinations: totalComboResults,
    allSubjects: computeWeightedAverage(semesterAware),
  });

  return rows;
}
