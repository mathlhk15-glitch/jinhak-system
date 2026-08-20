import { describe, it, expect } from "vitest";
import { normalizeStudentDataFile } from "../src/storage/normalize";
import { CURRENT_SCHEMA_VERSION, CURRENT_CURRICULUM_VERSION } from "../src/models/academic";

describe("normalizeStudentDataFile — 손상/불완전 JSON 안전 처리", () => {
  it("profile과 metadata가 아예 없는 v1.0 파일도 안전한 기본값으로 채워진다", () => {
    const malformed = { schemaVersion: "1.0", academicRecords: [] };
    const normalized = normalizeStudentDataFile(malformed);
    expect(normalized.profile).toEqual({});
    expect(normalized.metadata.createdAt).toBeTruthy();
    expect(normalized.metadata.updatedAt).toBeTruthy();
    expect(normalized.mockExams).toEqual([]);
    expect(normalized.targets).toEqual([]);
    expect(normalized.applications).toEqual([]);
  });

  it("완전히 빈 객체를 넣어도 크래시하지 않고 완전한 구조를 반환한다", () => {
    const normalized = normalizeStudentDataFile({});
    expect(normalized.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(normalized.curriculumVersion).toBe(CURRENT_CURRICULUM_VERSION);
    expect(Array.isArray(normalized.academicRecords)).toBe(true);
  });

  it("null/undefined/배열이 아닌 academicRecords는 빈 배열로 처리된다", () => {
    const normalized = normalizeStudentDataFile({ academicRecords: "잘못된값" });
    expect(normalized.academicRecords).toEqual([]);
  });

  it("record 안에 잘못된 필드 타입이 섞여 있어도 최소 필드로 보정해 보존한다", () => {
    const malformed = {
      schemaVersion: "1.0",
      academicRecords: [{ id: "x", subjectGroup: "국어", courseName: "국어1", credits: "네개" /* 잘못된 타입 */, evaluationType: "rankGrade", rankGrade: 2 }],
    };
    const normalized = normalizeStudentDataFile(malformed);
    expect(normalized.academicRecords).toHaveLength(1);
    expect(normalized.academicRecords[0].credits).toBe(0); // 안전한 기본값으로 보정
    expect(normalized.academicRecords[0].rankGrade).toBe(2); // 올바른 필드는 보존
  });

  it("알 수 없는 evaluationType은 rankGrade로 몰래 바꾸지 않고 'other'로 보존한다", () => {
    const malformed = {
      academicRecords: [{ id: "x", subjectGroup: "국어", courseName: "국어1", credits: 3, evaluationType: "someUnknownType" }],
    };
    const normalized = normalizeStudentDataFile(malformed);
    expect(normalized.academicRecords[0].evaluationType).toBe("other");
  });


  it("성취도 D/E를 손실 없이 보존한다", () => {
    const normalized = normalizeStudentDataFile({
      academicRecords: [
        { id: "d", academicYear: 2026, gradeLevel: 1, semester: 1, subjectGroup: "과학", courseName: "진로과목D", credits: 3, evaluationType: "achievement", achievement: "D" },
        { id: "e", academicYear: 2026, gradeLevel: 1, semester: 1, subjectGroup: "사회", courseName: "진로과목E", credits: 3, evaluationType: "achievement", achievement: "E" },
      ],
    });
    expect(normalized.academicRecords[0].achievement).toBe("D");
    expect(normalized.academicRecords[1].achievement).toBe("E");
  });

  it("profile.gradeLevel이 1/2/3이 아닌 값이면 undefined로 정규화된다", () => {
    const normalized = normalizeStudentDataFile({ profile: { gradeLevel: 7 } });
    expect(normalized.profile.gradeLevel).toBeUndefined();
  });
});
