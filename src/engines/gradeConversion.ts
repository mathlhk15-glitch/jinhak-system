/**
 * 5등급 평균 → 9등급 참고 환산.
 *
 * 기준은 사용자가 제공한 `내신 목표 등급 설정(1).xlsm`의
 * `9등급 환산` 시트(A2:B73)와 Sheet1!J2의
 * `VLOOKUP(I2,'9등급 환산'!A2:B73,2,1)` 동작을 그대로 옮긴 것이다.
 *
 * Excel의 근사 VLOOKUP(range_lookup=TRUE)은 조회값 이하의 가장 큰
 * 첫 열 값을 선택한다. 따라서 표 사이 값도 동일하게 "직전 구간" 값을 쓴다.
 * 이 값은 대학별 공식 환산식이 아니라 상담용 참고값이며, 원 5등급 평균을
 * 절대 덮어쓰지 않는다.
 */

import type { GradeScale } from "../models/academic";
import type { ComputedValue, WeightedAverageResult } from "./gradeEngine";
import { isEmpty, value } from "./gradeEngine";

export const FIVE_TO_NINE_GRADE_TABLE: readonly (readonly [number, number])[] = [
  [1, 1.2],
  [1.01, 1.25],
  [1.02, 1.35],
  [1.14, 1.74],
  [1.15, 1.86],
  [1.17, 1.91],
  [1.28, 1.97],
  [1.3, 2.09],
  [1.31, 2.11],
  [1.34, 2.14],
  [1.36, 2.17],
  [1.37, 2.19],
  [1.41, 2.2],
  [1.42, 2.25],
  [1.43, 2.27],
  [1.46, 2.29],
  [1.54, 2.32],
  [1.58, 2.41],
  [1.6, 2.54],
  [1.65, 2.6],
  [1.73, 2.66],
  [1.76, 2.71],
  [1.79, 2.88],
  [1.81, 2.91],
  [1.85, 3.1],
  [1.86, 3.23],
  [1.88, 3.27],
  [1.91, 3.3],
  [1.93, 3.34],
  [1.96, 3.37],
  [1.97, 3.41],
  [1.98, 3.44],
  [1.99, 3.46],
  [2.03, 3.47],
  [2.04, 3.5],
  [2.05, 3.56],
  [2.08, 3.6],
  [2.1, 3.65],
  [2.15, 3.68],
  [2.18, 3.7],
  [2.2, 3.8],
  [2.25, 3.9],
  [2.29, 4],
  [2.35, 4.09],
  [2.41, 4.18],
  [2.45, 4.22],
  [2.47, 4.24],
  [2.48, 4.29],
  [2.5, 4.3],
  [2.52, 4.33],
  [2.54, 4.4],
  [2.58, 4.47],
  [2.6, 4.52],
  [2.66, 4.57],
  [2.76, 4.65],
  [2.77, 4.7],
  [2.8, 4.75],
  [2.9, 4.8],
  [2.98, 4.85],
  [3, 4.93],
  [3.05, 5],
  [3.06, 5.06],
  [3.08, 5.12],
  [3.28, 5.32],
  [3.4, 5.56],
  [3.49, 5.72],
  [3.56, 5.94],
  [3.6, 5.99],
  [3.72, 6.01],
  [3.95, 6.38],
  [4.01, 6.5],
  [4.21, 6.91],
] as const;

/** Excel 근사 VLOOKUP과 동일한 구간 선택. 유효한 5등급 평균(1~5)만 처리한다. */
export function convertFiveGradeAverageToNine(average: number): number | null {
  if (!Number.isFinite(average) || average < 1 || average > 5) return null;
  let converted: number | null = null;
  for (const [threshold, nineGrade] of FIVE_TO_NINE_GRADE_TABLE) {
    if (average < threshold) break;
    converted = nineGrade;
  }
  return converted;
}

/**
 * 이미 9등급제이면 원값 자체가 9등급 값이다.
 * 5등급제이면 위 환산표를 적용한다.
 */
export function convertGradeAverageToNine(average: ComputedValue, gradeScale: GradeScale | null): ComputedValue {
  if (isEmpty(average) || gradeScale == null) return { kind: "empty" };
  if (gradeScale === 9) return value(average.value);
  const converted = convertFiveGradeAverageToNine(average.value);
  return converted == null ? { kind: "empty" } : value(converted);
}

export function convertWeightedAverageToNine(result: WeightedAverageResult): ComputedValue {
  return convertGradeAverageToNine(result.average, result.gradeScale);
}
