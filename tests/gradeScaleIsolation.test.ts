import { describe, it, expect } from "vitest";
import { getActiveGradeScale } from "../src/engines/gradeEngine";
import type { AcademicRecord } from "../src/models/academic";

function rec(gradeScale: 5 | 9 | undefined, rankGrade: number): AcademicRecord {
  return {
    id: Math.random().toString(),
    academicYear: 2026,
    gradeLevel: 3,
    semester: 1,
    subjectGroup: "국어",
    courseName: "테스트",
    credits: 4,
    evaluationType: "rankGrade",
    gradeScale,
    rankGrade,
  };
}

/**
 * 검수 지적(P0-3) 회귀 테스트: 목표등급 계산은 화면 상단의 "새 항목 기본 등급체계" 선택값이
 * 아니라, 실제 성적 데이터가 쓰고 있는 등급체계를 근거로 판단해야 한다. 이 테스트는 그
 * 판단 로직(getActiveGradeScale)이 전역 UI 상태와 완전히 무관하게 순수하게 데이터만으로
 * 동작하는지 확인한다 — 애초에 전역 변수를 인자로 받지 않으므로 구조적으로 격리되어 있다.
 */
describe("getActiveGradeScale — 목표등급 계산의 등급체계는 실제 데이터 기준", () => {
  it("모든 과목이 5등급제면 5를 반환한다", () => {
    expect(getActiveGradeScale([rec(5, 2), rec(5, 3)])).toBe(5);
  });

  it("모든 과목이 9등급제면 9를 반환한다", () => {
    expect(getActiveGradeScale([rec(9, 4), rec(9, 6)])).toBe(9);
  });

  it("5등급제와 9등급제가 섞여 있으면 null을 반환한다 (계산 금지 신호)", () => {
    expect(getActiveGradeScale([rec(5, 2), rec(9, 6)])).toBeNull();
  });

  it("3차 검수 회귀테스트: 등급값 자체가 무효한 레코드는 등급체계 판단에서 제외된다 (거짓 혼재 방지)", () => {
    // 국어(5등급제,2등급) 수학(5등급제,1등급)은 정상. 세 번째는 gradeScale=9인데
    // rankGrade=99로 애초에 계산 대상이 아닌 이상값 — 이 하나 때문에 나머지 정상적인
    // 5등급제 데이터까지 "혼재"로 오판해 목표등급 계산을 막아버리면 안 된다.
    const invalidNineScale: AcademicRecord = {
      id: "invalid",
      academicYear: 2026,
      gradeLevel: 3,
      semester: 1,
      subjectGroup: "과학",
      courseName: "이상값과목",
      credits: 3,
      evaluationType: "rankGrade",
      gradeScale: 9,
      rankGrade: 99, // 9등급제 범위(1~9)를 벗어난 값
    };
    const result = getActiveGradeScale([rec(5, 2), rec(5, 1), invalidNineScale]);
    expect(result).toBe(5);
  });

  it("데이터가 없으면 null을 반환한다", () => {
    expect(getActiveGradeScale([])).toBeNull();
  });

  it("gradeScale이 없는 레코드만 있으면 null을 반환한다", () => {
    expect(getActiveGradeScale([rec(undefined, 2)])).toBeNull();
  });

  it("achievement 유형 레코드는 gradeScale 판단에 영향을 주지 않는다", () => {
    const achievementRec: AcademicRecord = {
      id: "a",
      academicYear: 2026,
      gradeLevel: 3,
      semester: 1,
      subjectGroup: "국어",
      courseName: "성취과목",
      credits: 3,
      evaluationType: "achievement",
      achievement: "A",
    };
    expect(getActiveGradeScale([rec(5, 2), achievementRec])).toBe(5);
  });
});
