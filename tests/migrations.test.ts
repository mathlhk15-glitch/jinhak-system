import { describe, it, expect } from "vitest";
import { migrateToCurrent } from "../src/storage/migrations";
import { CURRENT_SCHEMA_VERSION } from "../src/models/academic";
import { parseAndMigrate } from "../src/storage/jsonBackup";
import { computeWeightedAverage } from "../src/engines/gradeEngine";

describe("migrateToCurrent — v0.9 → v1.0 실제 마이그레이션", () => {
  const oldFile = {
    schemaVersion: "0.9",
    academicRecords: [
      { id: "a1", academicYear: 2025, gradeLevel: 1, semester: 1, subjectGroup: "국어", courseName: "공통국어1", credits: 4, grade: 2 },
      { id: "a2", academicYear: 2025, gradeLevel: 1, semester: 1, subjectGroup: "수학", courseName: "공통수학1", credits: 4, grade: 1 },
    ],
  };

  it("현재 스키마 버전까지 변환하고, 적용된 마이그레이션 경로를 기록한다", () => {
    const outcome = migrateToCurrent(oldFile);
    expect(outcome.finalVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(outcome.appliedMigrations).toEqual(["0.9->1.0"]);
  });

  it("데이터 손실 없이 필드가 올바르게 변환된다 (grade → rankGrade, evaluationType 추가)", () => {
    const outcome = migrateToCurrent(oldFile);
    const rec = outcome.data.academicRecords[0];
    expect(rec.grade).toBeUndefined();
    expect(rec.rankGrade).toBe(2);
    expect(rec.evaluationType).toBe("rankGrade");
    expect(rec.gradeScale).toBe(5);
    // 다른 필드는 그대로 보존
    expect(rec.courseName).toBe("공통국어1");
    expect(rec.credits).toBe(4);
  });

  it("v0.9 파일에 metadata가 없어도 마이그레이션 후에는 반드시 생성된다 (검수 지적 반영)", () => {
    // 원본 v0.9 샘플에는 metadata 필드 자체가 없다. 마이그레이션이 이를 만들어주지
    // 않으면 이후 state.metadata.updatedAt 접근에서 TypeError가 발생한다.
    const outcome = migrateToCurrent(oldFile);
    expect(outcome.data.metadata).toBeDefined();
    expect(typeof outcome.data.metadata.createdAt).toBe("string");
    expect(typeof outcome.data.metadata.updatedAt).toBe("string");
    // 이후 실제 코드에서 하는 것과 동일한 접근이 크래시 없이 동작해야 한다.
    expect(() => {
      outcome.data.metadata.updatedAt = new Date().toISOString();
    }).not.toThrow();
  });


  it("2025학년도 고1 legacy는 코호트 기준으로 2022 개정/5등급제로 마이그레이션된다", () => {
    const outcome = migrateToCurrent({
      schemaVersion: "0.9",
      academicRecords: [
        { id: "c2025", academicYear: 2025, gradeLevel: 1, semester: 1, subjectGroup: "국어", courseName: "공통국어1", credits: 4, grade: 2 },
      ],
    });
    expect(outcome.data.curriculumVersion).toBe("2022");
    expect(outcome.data.academicRecords[0].gradeScale).toBe(5);
  });

  it("2024학년도 고1 legacy는 코호트 기준으로 2015 개정/9등급제로 마이그레이션된다", () => {
    const outcome = migrateToCurrent({
      schemaVersion: "0.9",
      academicRecords: [
        { id: "c2024", academicYear: 2024, gradeLevel: 1, semester: 1, subjectGroup: "국어", courseName: "국어", credits: 4, grade: 4 },
      ],
    });
    expect(outcome.data.curriculumVersion).toBe("2015");
    expect(outcome.data.academicRecords[0].gradeScale).toBe(9);
  });

  it("원본 객체는 변경하지 않는다 (불변성 보장)", () => {
    const before = JSON.stringify(oldFile);
    migrateToCurrent(oldFile);
    expect(JSON.stringify(oldFile)).toBe(before);
  });

  it("마이그레이션 후 계산엔진이 정상적으로 동작한다", () => {
    const outcome = migrateToCurrent(oldFile);
    const result = computeWeightedAverage(outcome.data.academicRecords);
    // 국어 4단위 2등급 + 수학 4단위 1등급 = (8+4)/8 = 1.5
    expect(result.totalCredits).toBe(8);
    if (result.average.kind === "value") {
      expect(result.average.value).toBeCloseTo(1.5, 5);
    }
  });

  it("이미 현재 버전인 파일은 마이그레이션 없이 그대로 통과한다", () => {
    const currentFile = { schemaVersion: CURRENT_SCHEMA_VERSION, academicRecords: [] };
    const outcome = migrateToCurrent(currentFile);
    expect(outcome.appliedMigrations).toEqual([]);
  });

  it("경로가 없는 미래 버전은 명확한 오류를 던진다", () => {
    const futureFile = { schemaVersion: "99.0", academicRecords: [] };
    expect(() => migrateToCurrent(futureFile)).toThrow();
  });
});

describe("parseAndMigrate — JSON 문자열 파싱 + 마이그레이션 통합", () => {
  it("v0.9 JSON 문자열을 불러오면 현재 버전으로 변환되어 반환된다", () => {
    const jsonText = JSON.stringify({
      schemaVersion: "0.9",
      academicRecords: [{ id: "x", academicYear: 2025, gradeLevel: 2, semester: 1, subjectGroup: "영어", courseName: "영어1", credits: 3, grade: 3 }],
    });
    const result = parseAndMigrate(jsonText);
    expect(result.wasMigrated).toBe(true);
    expect(result.data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.data.academicRecords[0].rankGrade).toBe(3);
  });

  it("손상된 JSON은 명확한 오류 메시지를 던진다", () => {
    expect(() => parseAndMigrate("{ 이건 JSON이 아님")).toThrow();
  });
});
