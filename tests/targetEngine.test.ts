import { describe, it, expect } from "vitest";
import { computeReverseTarget, computeScenarios } from "../src/engines/targetEngine";
import { isEmpty } from "../src/engines/gradeEngine";

describe("computeReverseTarget — 목표등급 역산", () => {
  it("스펙 예시: 60단위/1.82, 향후 25단위, 목표 1.70 → 필요평균 1.412", () => {
    const S = 60 * 1.82; // 109.2
    const result = computeReverseTarget({
      currentCredits: 60,
      currentScoreSum: S,
      futureCredits: 25,
      targetCumulativeGrade: 1.7,
      gradeScale: 5,
    });
    expect(result.feasibility).toBe("achievable");
    expect(isEmpty(result.requiredAverage)).toBe(false);
    if (!isEmpty(result.requiredAverage)) {
      expect(result.requiredAverage.value).toBeCloseTo(1.412, 3);
    }
  });

  it("R < 1 이면 달성 불가로 판정하고 최선의 누적등급을 함께 제공한다", () => {
    // 현재 평균이 매우 나쁘고(4.5) 목표가 매우 높아(1.0) 남은 단위로는 도달 불가능한 상황
    const S = 40 * 4.5;
    const result = computeReverseTarget({
      currentCredits: 40,
      currentScoreSum: S,
      futureCredits: 10,
      targetCumulativeGrade: 1.0,
      gradeScale: 5,
    });
    expect(result.feasibility).toBe("impossible");
    expect(result.bestPossibleCumulative).toBeDefined();
    // 남은 10단위 전부 1등급을 받아도: (180 + 10*1) / 50 = 3.8
    expect(result.bestPossibleCumulative!).toBeCloseTo(3.8, 5);
  });

  it("필요 평균이 등급체계 최댓값을 넘으면 이미 목표가 확보된 상태로 판정한다", () => {
    const S = 40 * 1.2; // 이미 매우 좋은 평균
    const result = computeReverseTarget({
      currentCredits: 40,
      currentScoreSum: S,
      futureCredits: 10,
      targetCumulativeGrade: 2.0,
      gradeScale: 5,
    });
    expect(result.feasibility).toBe("already_secured");
    expect(result.worstCaseCumulative).toBeDefined();
  });

  it("futureCredits가 0이면 계산할 수 없음을 안전하게 반환한다", () => {
    const result = computeReverseTarget({
      currentCredits: 40,
      currentScoreSum: 40 * 2,
      futureCredits: 0,
      targetCumulativeGrade: 1.5,
      gradeScale: 5,
    });
    expect(result.feasibility).toBe("impossible");
    expect(isEmpty(result.requiredAverage)).toBe(true);
  });
});

describe("computeScenarios — 시나리오 표", () => {
  it("모든 값이 입력 데이터에서 동적으로 계산된다 (하드코딩 예시값과 무관)", () => {
    const U = 60;
    const S = 60 * 1.82;
    const F = 25;
    const scenarios = computeScenarios(U, S, F, 5);
    expect(scenarios.length).toBeGreaterThan(0);
    for (const row of scenarios) {
      const expected = (S + F * row.futureAverage) / (U + F);
      if (!isEmpty(row.expectedCumulative)) {
        expect(row.expectedCumulative.value).toBeCloseTo(expected, 5);
      }
    }
  });

  it("futureCredits가 0이면 빈 배열을 반환한다", () => {
    expect(computeScenarios(60, 100, 0, 5)).toEqual([]);
  });

  it("등급체계 최댓값(5.0, 9.0)이 간격과 무관하게 항상 마지막 행에 포함된다", () => {
    // 검수 지적: 0.3 간격만 쓰면 1.0에서 시작해 5.0이나 9.0이 정확히 떨어지지 않아 표에서 누락될 수 있었다.
    const scenarios5 = computeScenarios(60, 60 * 1.82, 25, 5);
    expect(scenarios5[scenarios5.length - 1].futureAverage).toBe(5);

    const scenarios9 = computeScenarios(60, 60 * 3.5, 25, 9);
    expect(scenarios9[scenarios9.length - 1].futureAverage).toBe(9);
  });
});
