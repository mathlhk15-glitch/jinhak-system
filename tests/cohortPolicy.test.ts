import { describe, it, expect } from "vitest";
import { getCohortPolicy, FIVE_GRADE_SYSTEM_START_ENTRY_YEAR } from "../src/models/cohortPolicy";

/**
 * 검수 지적(도메인 P0) 회귀 테스트: 5등급제(2022 개정 교육과정)는 2025학년도 고1
 * 입학생부터 적용된다. 그 이전 입학생은 9등급제(2015 개정 교육과정)를 그대로 따른다.
 * 이 로직이 잘못되면 실제 학생 상담 결과(목표등급 계산 등)에 직접 영향을 준다.
 */
describe("getCohortPolicy — 입학연도 기반 교육과정/등급체계 판정", () => {
  it("2026학년도 3학년(2024년 입학)은 9등급제/2015 개정 교육과정이다", () => {
    const policy = getCohortPolicy(2026, 3);
    expect(policy.gradeScale).toBe(9);
    expect(policy.curriculumVersion).toBe("2015");
  });

  it("2026학년도 2학년(2025년 입학)은 5등급제/2022 개정 교육과정이다", () => {
    const policy = getCohortPolicy(2026, 2);
    expect(policy.gradeScale).toBe(5);
    expect(policy.curriculumVersion).toBe("2022");
  });

  it("2026학년도 1학년(2026년 입학)은 5등급제/2022 개정 교육과정이다", () => {
    const policy = getCohortPolicy(2026, 1);
    expect(policy.gradeScale).toBe(5);
  });

  it("2027학년도 3학년(2025년 입학)부터는 3학년도 5등급제로 전환된다", () => {
    // 이것이 하드코딩된 상수 대신 코호트 함수를 쓰는 핵심 이유 — 시간이 지나면
    // "현재 3학년"이 가리키는 실제 세대가 바뀐다.
    const policy = getCohortPolicy(2027, 3);
    expect(policy.gradeScale).toBe(5);
    expect(policy.curriculumVersion).toBe("2022");
  });

  it("경계값: 입학연도가 정확히 제도 시행연도(2025)면 5등급제다", () => {
    const policy = getCohortPolicy(2025, 1); // 2025학년도 고1 = 2025년 입학
    expect(policy.gradeScale).toBe(5);
    expect(FIVE_GRADE_SYSTEM_START_ENTRY_YEAR).toBe(2025);
  });

  it("경계값: 제도 시행 직전 연도(2024) 입학생은 9등급제다", () => {
    const policy = getCohortPolicy(2024, 1); // 2024학년도 고1 = 2024년 입학
    expect(policy.gradeScale).toBe(9);
    expect(policy.curriculumVersion).toBe("2015");
  });
});

describe("createEmptyDataFile — 3학년 MVP 기본값이 실제 코호트와 일치하는지", () => {
  it("새 파일의 profile.gradeLevel은 3으로 초기화된다 (검수 지적: 이전에는 초기값이 없어 Excel에 '학년: -'로 표시될 수 있었음)", async () => {
    const { createEmptyDataFile } = await import("../src/models/academic");
    const data = createEmptyDataFile();
    expect(data.profile.gradeLevel).toBe(3);
  });

  it("현재 연도 기준 3학년 코호트의 curriculumVersion이 정확히 반영된다", async () => {
    const { createEmptyDataFile } = await import("../src/models/academic");
    const { getCohortPolicy } = await import("../src/models/cohortPolicy");
    const data = createEmptyDataFile();
    const { getCurrentAcademicYear } = await import("../src/utils/academicYear");
    const expected = getCohortPolicy(getCurrentAcademicYear(), 3);
    expect(data.curriculumVersion).toBe(expected.curriculumVersion);
  });
});
