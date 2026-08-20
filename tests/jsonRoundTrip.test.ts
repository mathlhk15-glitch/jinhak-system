import { describe, it, expect } from "vitest";
import { exportToJsonString, parseAndMigrate } from "../src/storage/jsonBackup";
import { createEmptyDataFile } from "../src/models/academic";
import type { AcademicRecord } from "../src/models/academic";

describe("JSON 왕복 시 P/F·기타 유형 원자료 보존", () => {
  it("passFail 레코드가 내보내기→불러오기 후에도 그대로 유지된다 (rankGrade로 몰래 바뀌지 않음)", () => {
    const data = createEmptyDataFile();
    const pfRecord: AcademicRecord = {
      id: "pf1",
      academicYear: 2026,
      gradeLevel: 3,
      semester: 1,
      subjectGroup: "체육",
      courseName: "운동과건강",
      credits: 2,
      evaluationType: "passFail",
      memo: "P/F 과목",
    };
    data.academicRecords = [pfRecord];

    const json = exportToJsonString(data);
    const result = parseAndMigrate(json);

    const restored = result.data.academicRecords.find((r) => r.id === "pf1");
    expect(restored).toBeDefined();
    expect(restored!.evaluationType).toBe("passFail");
    expect(restored!.courseName).toBe("운동과건강");
    expect(restored!.credits).toBe(2);
  });

  it("other 유형 레코드도 동일하게 보존된다", () => {
    const data = createEmptyDataFile();
    data.academicRecords = [
      {
        id: "o1",
        academicYear: 2026,
        gradeLevel: 2,
        semester: 2,
        subjectGroup: "기타",
        courseName: "특수과목",
        credits: 1,
        evaluationType: "other",
      },
    ];
    const result = parseAndMigrate(exportToJsonString(data));
    expect(result.data.academicRecords[0].evaluationType).toBe("other");
  });

  it("rankGrade와 achievement 레코드가 섞여 있어도 각각 올바른 유형으로 왕복된다", () => {
    const data = createEmptyDataFile();
    data.academicRecords = [
      {
        id: "r1",
        academicYear: 2026,
        gradeLevel: 1,
        semester: 1,
        subjectGroup: "국어",
        courseName: "공통국어1",
        credits: 4,
        evaluationType: "rankGrade",
        gradeScale: 5,
        rankGrade: 2,
      },
      {
        id: "a1",
        academicYear: 2026,
        gradeLevel: 1,
        semester: 1,
        subjectGroup: "국어",
        courseName: "진로선택국어",
        credits: 3,
        evaluationType: "achievement",
        achievement: "A",
      },
    ];
    const result = parseAndMigrate(exportToJsonString(data));
    const r1 = result.data.academicRecords.find((r) => r.id === "r1")!;
    const a1 = result.data.academicRecords.find((r) => r.id === "a1")!;
    expect(r1.evaluationType).toBe("rankGrade");
    expect(r1.rankGrade).toBe(2);
    expect(a1.evaluationType).toBe("achievement");
    expect(a1.achievement).toBe("A");
  });
});
