import { describe, it, expect } from "vitest";
import { splitRecordsBySourceMode } from "../src/engines/recordReconciliation";
import type { AcademicRecord } from "../src/models/academic";

/**
 * 검수 지적(P0-2) 회귀 테스트: 1·2학년 정밀입력(Phase 3)에서 만들어진 레코드가
 * 3학년 빠른모드를 거치면서 courseId·실제 학년/학기·rawScore·memo 등이 사라지거나
 * "국어 항목1" 같은 집계값으로 축소되면 안 된다.
 */
describe("splitRecordsBySourceMode — 정밀입력 원자료 보존", () => {
  const preciseRecord: AcademicRecord = {
    id: "precise_1",
    courseId: "C22_KOR_001",
    academicYear: 2025,
    gradeLevel: 1,
    semester: 1,
    subjectGroup: "국어",
    courseName: "공통국어1",
    credits: 4,
    evaluationType: "rankGrade",
    gradeScale: 5,
    rankGrade: 2,
    rawScore: 87,
    courseAverage: 75.3,
    enrollmentCount: 312,
    memo: "1학기 중간고사 우수",
    sourceMode: "precise",
  };

  const quickRecord: AcademicRecord = {
    id: "quick_1",
    academicYear: 2026,
    gradeLevel: 3,
    semester: 1,
    subjectGroup: "수학",
    courseName: "수학 항목1",
    credits: 4,
    evaluationType: "rankGrade",
    gradeScale: 5,
    rankGrade: 3,
    sourceMode: "quickAggregate",
  };

  const legacyRecordWithoutSourceMode: AcademicRecord = {
    id: "legacy_1",
    academicYear: 2026,
    gradeLevel: 3,
    semester: 1,
    subjectGroup: "영어",
    courseName: "영어 항목1",
    credits: 3,
    evaluationType: "rankGrade",
    gradeScale: 5,
    rankGrade: 2,
    // sourceMode 필드 자체가 없음 (이 기능이 추가되기 전 저장된 v1.0 파일을 흉내냄)
  };

  it("precise 레코드는 preserved로 분류되고, 모든 필드가 원본 그대로 유지된다", () => {
    const { preserved } = splitRecordsBySourceMode([preciseRecord]);
    expect(preserved).toHaveLength(1);
    expect(preserved[0]).toEqual(preciseRecord); // 필드 하나도 손실/변형 없이 동일해야 한다
    expect(preserved[0].courseId).toBe("C22_KOR_001");
    expect(preserved[0].gradeLevel).toBe(1);
    expect(preserved[0].semester).toBe(1);
    expect(preserved[0].courseName).toBe("공통국어1"); // "국어 항목1"로 축소되지 않음
    expect(preserved[0].rawScore).toBe(87);
    expect(preserved[0].courseAverage).toBe(75.3);
    expect(preserved[0].enrollmentCount).toBe(312);
    expect(preserved[0].memo).toBe("1학기 중간고사 우수");
  });

  it("quickAggregate 레코드는 editable로 분류된다", () => {
    const { editable, preserved } = splitRecordsBySourceMode([quickRecord]);
    expect(editable).toHaveLength(1);
    expect(preserved).toHaveLength(0);
  });

  it("sourceMode가 없는 구버전 레코드는 editable로 분류된다 (하위호환)", () => {
    const { editable, preserved } = splitRecordsBySourceMode([legacyRecordWithoutSourceMode]);
    expect(editable).toHaveLength(1);
    expect(preserved).toHaveLength(0);
  });

  it("precise·quickAggregate·구버전 레코드가 섞여 있어도 각각 올바르게 분류된다", () => {
    const { editable, preserved } = splitRecordsBySourceMode([preciseRecord, quickRecord, legacyRecordWithoutSourceMode]);
    expect(preserved.map((r) => r.id)).toEqual(["precise_1"]);
    expect(editable.map((r) => r.id).sort()).toEqual(["legacy_1", "quick_1"]);
  });

  it("빈 배열을 넣으면 둘 다 빈 배열을 반환한다", () => {
    const { editable, preserved } = splitRecordsBySourceMode([]);
    expect(editable).toEqual([]);
    expect(preserved).toEqual([]);
  });
});
