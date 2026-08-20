import { describe, it, expect } from "vitest";
import { computeWeightedAverage } from "../src/engines/gradeEngine";
import type { AcademicRecord } from "../src/models/academic";

/**
 * 원본 `3학년 수시 상담.xlsx`의 "예시" 시트 데이터를 그대로 입력했을 때,
 * 우리 엔진이 원본 Excel의 F24(국수영사과한 가중평균)·F25(전교과 가중평균) 수식과
 * 동일한 결과를 내는지 검증한다.
 *
 * 원본 수식:
 *   F24 = (U16*V16+U17*V17+U18*V18+U19*V19+U20*V20+U21*V21) / (U16+...+U21)
 *   F25 = F24 분자·분모에 그외(U22*V22) 포함
 * 여기서 U/V는 각 교과군의 "단위수합"과 "가중평균등급"이며, 수학적으로
 * Σ(단위수×등급)를 다시 가중평균한 것과 전체를 한번에 가중평균한 것은 동일하다
 * (Σ의 분배법칙). 우리 엔진(computeWeightedAverage)은 후자 방식을 쓰므로,
 * 값이 정확히 같아야 원본과 동등한 계산이라고 볼 수 있다.
 *
 * 예시 시트 원본 값(엑셀에서 직접 추출):
 *   국: (4,1)(4,1)(4,3)(4,3)(5,1)
 *   수: (4,5)(4,4)(4,4)(4,4)(4,5)
 *   영: (4,3)(4,3)(4,3)(4,3)(3,3)
 *   한국사: (3,4)(3,4)
 *   사회: (3,3)(3,4)
 *   과학: (3,2)(3,3)(3,4)(3,4)(3,3)(3,3)(3,3)(3,5)
 *   그외: (3,3)(2,3)(3,2)(2,2)(2,2)(2,1)
 *
 * 손으로 검산한 기대값: F24 = 308/96 ≈ 3.208333, F25 = 339/110 ≈ 3.081818
 */

function pairsToRecords(subjectGroup: string, pairs: [number, number][]): AcademicRecord[] {
  return pairs.map(([credits, rankGrade], i) => ({
    id: `${subjectGroup}_${i}`,
    academicYear: 2026,
    gradeLevel: 3,
    semester: 1,
    subjectGroup,
    courseName: `${subjectGroup}_${i}`,
    credits,
    evaluationType: "rankGrade",
    gradeScale: 9,
    rankGrade,
  }));
}

describe("원본 3학년 Excel 예시 시트 재현 — F24/F25 일치 검증", () => {
  const 국 = pairsToRecords("국어", [
    [4, 1],
    [4, 1],
    [4, 3],
    [4, 3],
    [5, 1],
  ]);
  const 수 = pairsToRecords("수학", [
    [4, 5],
    [4, 4],
    [4, 4],
    [4, 4],
    [4, 5],
  ]);
  const 영 = pairsToRecords("영어", [
    [4, 3],
    [4, 3],
    [4, 3],
    [4, 3],
    [3, 3],
  ]);
  const 한국사 = pairsToRecords("한국사", [
    [3, 4],
    [3, 4],
  ]);
  const 사회 = pairsToRecords("사회", [
    [3, 3],
    [3, 4],
  ]);
  const 과학 = pairsToRecords("과학", [
    [3, 2],
    [3, 3],
    [3, 4],
    [3, 4],
    [3, 3],
    [3, 3],
    [3, 3],
    [3, 5],
  ]);
  const 그외 = pairsToRecords("기타", [
    [3, 3],
    [2, 3],
    [3, 2],
    [2, 2],
    [2, 2],
    [2, 1],
  ]);

  it("F24 상당(국수영사과한국사, '그외' 제외) = 308/96 ≈ 3.208333", () => {
    const records = [...국, ...수, ...영, ...한국사, ...사회, ...과학];
    const result = computeWeightedAverage(records);
    expect(result.totalCredits).toBe(96);
    if (result.average.kind === "value") {
      expect(result.average.value).toBeCloseTo(308 / 96, 6);
      expect(result.average.value).toBeCloseTo(3.208333, 5);
    } else {
      throw new Error("평균이 계산되지 않았습니다.");
    }
  });

  it("F25 상당(전교과, '그외' 포함) = 339/110 ≈ 3.081818", () => {
    const records = [...국, ...수, ...영, ...한국사, ...사회, ...과학, ...그외];
    const result = computeWeightedAverage(records);
    expect(result.totalCredits).toBe(110);
    if (result.average.kind === "value") {
      expect(result.average.value).toBeCloseTo(339 / 110, 6);
      expect(result.average.value).toBeCloseTo(3.081818, 5);
    } else {
      throw new Error("평균이 계산되지 않았습니다.");
    }
  });

  it("개별 교과군 가중평균도 원본 시트 값과 일치한다 (국어 37/21, 수학 88/20)", () => {
    const korResult = computeWeightedAverage(국);
    const mathResult = computeWeightedAverage(수);
    if (korResult.average.kind === "value") expect(korResult.average.value).toBeCloseTo(37 / 21, 6);
    if (mathResult.average.kind === "value") expect(mathResult.average.value).toBeCloseTo(88 / 20, 6);
  });
});
