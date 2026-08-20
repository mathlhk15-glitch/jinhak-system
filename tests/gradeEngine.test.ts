import { describe, it, expect } from "vitest";
import { computeWeightedAverage, formatGrade, isEmpty } from "../src/engines/gradeEngine";
import type { AcademicRecord } from "../src/models/academic";

function rec(partial: Partial<AcademicRecord>): AcademicRecord {
  return {
    id: partial.id ?? Math.random().toString(),
    academicYear: 2026,
    gradeLevel: 1,
    semester: 1,
    subjectGroup: "국어",
    courseName: "테스트과목",
    credits: 4,
    evaluationType: "rankGrade",
    gradeScale: 5,
    ...partial,
  };
}

describe("computeWeightedAverage — 단위수 가중평균", () => {
  it("스펙 예시: 국4/1, 수4/2, 영3/2, 정보2/4 → 26/13 = 2.00", () => {
    const records = [
      rec({ subjectGroup: "국어", courseName: "국어", credits: 4, rankGrade: 1 }),
      rec({ subjectGroup: "수학", courseName: "수학", credits: 4, rankGrade: 2 }),
      rec({ subjectGroup: "영어", courseName: "영어", credits: 3, rankGrade: 2 }),
      rec({ subjectGroup: "정보", courseName: "정보", credits: 2, rankGrade: 4 }),
    ];
    const result = computeWeightedAverage(records);
    expect(result.totalCredits).toBe(13);
    expect(isEmpty(result.average)).toBe(false);
    if (!isEmpty(result.average)) {
      expect(result.average.value).toBeCloseTo(2.0, 5);
    }
    expect(formatGrade(result.average)).toBe("2.00");
  });

  it("단순평균(2.25)과는 다른 값이어야 한다 — 단위수 가중치가 실제로 반영됨을 검증", () => {
    const records = [
      rec({ credits: 4, rankGrade: 1 }),
      rec({ credits: 4, rankGrade: 2 }),
      rec({ credits: 3, rankGrade: 2 }),
      rec({ credits: 2, rankGrade: 4 }),
    ];
    const result = computeWeightedAverage(records);
    const simpleAverage = (1 + 2 + 2 + 4) / 4; // 2.25
    if (!isEmpty(result.average)) {
      expect(result.average.value).not.toBeCloseTo(simpleAverage, 5);
    }
  });

  it("빈 값(과목 없음) — NaN/Infinity 없이 empty를 반환하고 '-'로 표시된다", () => {
    const result = computeWeightedAverage([]);
    expect(isEmpty(result.average)).toBe(true);
    expect(formatGrade(result.average)).toBe("-");
    expect(result.totalCredits).toBe(0);
    expect(Number.isFinite(result.totalCredits)).toBe(true);
  });

  it("단위수가 0인 항목은 계산에서 제외된다 (0으로 나누기 방지)", () => {
    const records = [rec({ credits: 0, rankGrade: 3 })];
    const result = computeWeightedAverage(records);
    expect(isEmpty(result.average)).toBe(true);
  });

  it("성취평가(A/B/C) 과목은 가중평균 계산에서 완전히 제외되고 별도 목록에만 나타난다", () => {
    const records = [
      rec({ subjectGroup: "국어", courseName: "공통국어", credits: 4, rankGrade: 2, evaluationType: "rankGrade" }),
      rec({
        subjectGroup: "국어",
        courseName: "진로선택국어",
        credits: 3,
        evaluationType: "achievement",
        achievement: "A",
        rankGrade: undefined,
      }),
    ];
    const result = computeWeightedAverage(records);
    expect(result.courseCount).toBe(1);
    expect(result.totalCredits).toBe(4); // achievement 과목의 3단위는 포함되지 않음
    if (!isEmpty(result.average)) {
      expect(result.average.value).toBeCloseTo(2.0, 5); // A를 숫자로 환산해 섞지 않음
    }
    expect(result.excludedAchievementCourses).toHaveLength(1);
    expect(result.excludedAchievementCourses[0].achievement).toBe("A");
  });

  it("서로 다른 gradeScale이 섞이면 경고 플래그가 true가 되고, 평균은 계산하지 않는다(원칙 강제)", () => {
    const records = [
      rec({ gradeScale: 5, rankGrade: 2 }),
      rec({ gradeScale: 9, rankGrade: 3 }),
    ];
    const result = computeWeightedAverage(records);
    expect(result.mixedGradeScaleWarning).toBe(true);
    // 검수 지적 반영: 이전에는 경고만 표시하고 실제로는 그대로 평균을 계산해 버렸다.
    // 원칙(5등급제/9등급제를 섞지 않는다)에 따라 이제는 값 자체를 비워야 한다.
    expect(isEmpty(result.average)).toBe(true);
    expect(result.courseCount).toBe(0);
  });

  it("gradeScale이 지정되지 않은 rankGrade 과목은 계산에서 제외되고 사유가 보고된다 (혼재로 취급하지 않되, 유효하지 않은 데이터로 처리)", () => {
    // 검수 지적(P0-1) 반영: gradeScale이 없으면 1~gradeScale 범위 검증 자체가 불가능하므로,
    // 이런 레코드를 "계산해도 되는 값"으로 취급하면 안 된다. mixedGradeScaleWarning은 아니지만
    // (등급체계가 여러 개 섞인 게 아니라 아예 없는 것이므로) invalidCourses로 보고하고 제외한다.
    const records = [rec({ gradeScale: undefined, rankGrade: 2 }), rec({ gradeScale: undefined, rankGrade: 3 })];
    const result = computeWeightedAverage(records);
    expect(result.mixedGradeScaleWarning).toBe(false);
    expect(isEmpty(result.average)).toBe(true);
    expect(result.invalidCourses).toHaveLength(2);
    expect(result.invalidCourses[0].reason).toContain("등급체계");
  });

  it("P0-1 회귀테스트: 5등급제인데 8등급처럼 범위를 벗어난 값은 UI 검증과 무관하게 평균에 반영되지 않는다", () => {
    // JSON을 통해 UI 검증을 거치지 않고 들어온 값을 흉내낸다.
    const records = [
      rec({ subjectGroup: "국어", courseName: "정상과목", credits: 4, gradeScale: 5, rankGrade: 2 }),
      rec({ subjectGroup: "국어", courseName: "이상값과목", credits: 4, gradeScale: 5, rankGrade: 8 }),
    ];
    const result = computeWeightedAverage(records);
    // 이상값 과목이 반영됐다면 평균은 (4*2+4*8)/8=5.0이 되지만, 정상과목만 반영되면 2.0이어야 한다.
    expect(isEmpty(result.average)).toBe(false);
    if (result.average.kind === "value") {
      expect(result.average.value).toBeCloseTo(2.0, 5);
    }
    expect(result.totalCredits).toBe(4);
    expect(result.invalidCourses).toHaveLength(1);
    expect(result.invalidCourses[0].courseName).toBe("이상값과목");
    expect(result.invalidCourses[0].reason).toContain("범위 초과");
  });

  it("3차 검수 회귀테스트: 단위수 21처럼 상한을 벗어난 값도 UI 검증과 무관하게 평균에 반영되지 않는다", () => {
    const records = [
      rec({ subjectGroup: "국어", courseName: "정상과목", credits: 4, gradeScale: 5, rankGrade: 2 }),
      rec({ subjectGroup: "국어", courseName: "단위수이상값과목", credits: 21, gradeScale: 5, rankGrade: 2 }),
    ];
    const result = computeWeightedAverage(records);
    expect(result.totalCredits).toBe(4); // 21단위 과목은 합산에서 제외되어야 함
    expect(result.invalidCourses).toHaveLength(1);
    expect(result.invalidCourses[0].courseName).toBe("단위수이상값과목");
    expect(result.invalidCourses[0].reason).toContain("단위수 범위 초과");
  });

  it("단위수가 음수이거나 비정상인 rankGrade 과목도 제외된다", () => {
    const records = [rec({ credits: -1, gradeScale: 5, rankGrade: 2 }), rec({ credits: NaN, gradeScale: 5, rankGrade: 2 })];
    const result = computeWeightedAverage(records);
    expect(isEmpty(result.average)).toBe(true);
    expect(result.invalidCourses).toHaveLength(2);
  });
});
