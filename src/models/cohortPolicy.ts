/**
 * 학생 코호트(입학연도)에 따른 교육과정·내신 등급체계 자동 판정.
 *
 * 배경: 교육부 2028 대학입시제도 개편에 따라 내신 5등급제(2022 개정 교육과정)는
 * 2025학년도 고1 입학생부터 적용된다. 그 이전 입학생(2024년 이전 입학)은 기존
 * 9등급제(2015 개정 교육과정)를 그대로 적용받는다.
 *
 * 따라서 등급체계는 "프로그램이 지금 몇 년도인가"가 아니라 "이 학생이 언제
 * 고등학교에 입학했는가"로 결정되는 값이며, 학년이 올라가도 바뀌지 않는다
 * (검수 지적 반영 — P0: 이 판정을 프로그램의 전역 기본값 하나로 처리하면
 *  현재 3학년처럼 구체제를 적용받는 학생에게 신체제 기본값이 잘못 적용될 수 있다).
 *
 * 예) 2026학년도 기준
 *   고3(2024년 입학) → 입학연도 2024 → 2015 개정 / 9등급제
 *   고2(2025년 입학) → 입학연도 2025 → 2022 개정 / 5등급제
 *   고1(2026년 입학) → 입학연도 2026 → 2022 개정 / 5등급제
 *
 * 참고: 교육부 "2028 대학입시제도 개편 확정안"(2023.12.27), 관련 보도자료 다수.
 */

import type { GradeScale } from "./academic";

export interface CohortPolicy {
  curriculumVersion: "2015" | "2022";
  gradeScale: GradeScale;
}

/** 5등급제(2022 개정 교육과정)가 처음 적용되는 고1 입학연도. */
export const FIVE_GRADE_SYSTEM_START_ENTRY_YEAR = 2025;

/**
 * academicYear(해당 학년도)와 gradeLevel(그 시점의 학년)로부터 고등학교 입학연도를
 * 역산하고, 그 입학연도가 어느 체제를 적용받는지 판정한다.
 *
 * 예: academicYear=2026, gradeLevel=3 → 입학연도 = 2026 - 3 + 1 = 2024 → 9등급제(구체제)
 */
export function getCohortPolicy(academicYear: number, gradeLevel: 1 | 2 | 3): CohortPolicy {
  const entryYear = academicYear - gradeLevel + 1;
  if (entryYear >= FIVE_GRADE_SYSTEM_START_ENTRY_YEAR) {
    return { curriculumVersion: "2022", gradeScale: 5 };
  }
  return { curriculumVersion: "2015", gradeScale: 9 };
}
