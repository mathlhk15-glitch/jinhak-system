/**
 * 목표등급 역산 엔진
 *
 * 현재까지 이수단위 U, 현재 등급점수 합 S = Σ(단위수×등급), 앞으로 이수할 단위수 F,
 * 목표 누적등급 T 라면, 앞으로 필요한 평균 R은:
 *
 *     R = [T(U+F) - S] / F
 *
 * 등급은 숫자가 작을수록 좋은 성적이므로:
 *  - R < 1  → 물리적으로 달성 불가능 (최고 등급이 1이므로)
 *  - R > gradeScale의 최댓값 → 이미 사실상 달성이 매우 쉬운 상태
 */

import type { ComputedValue } from "./gradeEngine";
import { value, isEmpty } from "./gradeEngine";
import type { GradeScale } from "../models/academic";

export interface ReverseTargetInput {
  currentCredits: number; // U
  currentScoreSum: number; // S = Σ(단위수×등급)
  futureCredits: number; // F
  targetCumulativeGrade: number; // T
  gradeScale: GradeScale; // 최댓값 판정 기준 (기본 5등급제)
}

export type TargetFeasibility = "achievable" | "impossible" | "already_secured";

export interface ReverseTargetResult {
  requiredAverage: ComputedValue;
  feasibility: TargetFeasibility;
  /** impossible일 때: 남은 전 과목 1등급을 받아도 도달 가능한 최선의 누적등급 */
  bestPossibleCumulative?: number;
  /** already_secured일 때: 남은 전 과목 최하위 등급(gradeScale)을 받아도 도달 가능한 최악의 누적등급 */
  worstCaseCumulative?: number;
  message: string;
}

export function computeReverseTarget(input: ReverseTargetInput): ReverseTargetResult {
  const { currentCredits: U, currentScoreSum: S, futureCredits: F, targetCumulativeGrade: T, gradeScale } = input;

  if (F <= 0) {
    return {
      requiredAverage: { kind: "empty" },
      feasibility: "impossible",
      message: "앞으로 이수할 단위수가 없어 계산할 수 없습니다.",
    };
  }

  const R = (T * (U + F) - S) / F;

  if (R < 1) {
    const bestPossible = (S + F * 1) / (U + F);
    return {
      requiredAverage: value(R),
      feasibility: "impossible",
      bestPossibleCumulative: bestPossible,
      message:
        `현재 조건에서는 목표 달성이 불가능합니다.\n` +
        `남은 모든 과목에서 1등급을 받을 경우 가능한 최적 누적등급: ${bestPossible.toFixed(2)}`,
    };
  }

  if (R > gradeScale) {
    const worstCase = (S + F * gradeScale) / (U + F);
    return {
      requiredAverage: value(R),
      feasibility: "already_secured",
      worstCaseCumulative: worstCase,
      message:
        `현재 조건에서는 목표가 이미 사실상 확보된 상태입니다.\n` +
        `남은 모든 과목에서 최하위 등급(${gradeScale}등급)을 받아도 예상 누적등급: ${worstCase.toFixed(2)}`,
    };
  }

  return {
    requiredAverage: value(R),
    feasibility: "achievable",
    message: `다음 구간 동안 평균 ${R.toFixed(2)}등급 이내(그 등급 또는 더 좋은 등급)를 유지하면 목표에 도달합니다.`,
  };
}

export interface ScenarioRow {
  futureAverage: number;
  expectedCumulative: ComputedValue;
}

/**
 * 다음 학기 평균등급 후보별 예상 누적등급 시나리오.
 * 후보값은 하드코딩하지 않고 gradeScale 범위에서 동적으로 생성한다 (1.0부터 gradeScale까지 0.3 간격).
 */
export function computeScenarios(
  currentCredits: number,
  currentScoreSum: number,
  futureCredits: number,
  gradeScale: GradeScale,
  step = 0.3
): ScenarioRow[] {
  if (futureCredits <= 0) return [];
  const rows: ScenarioRow[] = [];
  const candidates: number[] = [];
  for (let avg = 1.0; avg < gradeScale - 1e-9; avg = Math.round((avg + step) * 100) / 100) {
    candidates.push(Math.round(avg * 100) / 100);
  }
  candidates.push(gradeScale); // 검수 지적: 0.3 간격만으로는 등급체계 최댓값(5.0, 9.0 등)이 표에서 누락될 수 있어 항상 마지막에 명시적으로 포함한다.

  for (const avg of candidates) {
    const cumulative = (currentScoreSum + futureCredits * avg) / (currentCredits + futureCredits);
    rows.push({ futureAverage: avg, expectedCumulative: value(cumulative) });
  }
  return rows;
}

export { isEmpty };
