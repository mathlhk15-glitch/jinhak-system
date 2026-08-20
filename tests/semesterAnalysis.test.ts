import { describe, expect, it } from "vitest";
import type { AcademicRecord } from "../src/models/academic";
import { computeSemesterCombinationMatrix } from "../src/engines/semesterAnalysis";
import { REFERENCE_COMBINATIONS } from "../src/models/subjectCombinations";

function rec(id: string, gradeLevel: 1|2|3, semester: 1|2, subjectGroup: string, credits: number, rankGrade: number): AcademicRecord {
  return {
    id,
    academicYear: 2026 - (3 - gradeLevel),
    gradeLevel,
    semester,
    subjectGroup,
    courseName: id,
    credits,
    evaluationType: "rankGrade",
    gradeScale: 9,
    rankGrade,
    sourceMode: "precise",
  };
}

describe("semester combination analysis", () => {
  it("학기별 및 전체를 단위수 가중평균으로 계산한다", () => {
    const records = [
      rec("국어11", 1, 1, "국어", 4, 1),
      rec("영어11", 1, 1, "영어", 4, 2),
      rec("수학11", 1, 1, "수학", 4, 3),
      rec("국어12", 1, 2, "국어", 2, 2),
      rec("영어12", 1, 2, "영어", 2, 2),
      rec("수학12", 1, 2, "수학", 2, 2),
    ];
    const matrix = computeSemesterCombinationMatrix(records, REFERENCE_COMBINATIONS);
    const first = matrix.find((x) => x.label === "1학년 1학기")!;
    expect(first.combinations.kme.average.kind).toBe("value");
    if (first.combinations.kme.average.kind === "value") expect(first.combinations.kme.average.value).toBeCloseTo(2, 8);
    const total = matrix.at(-1)!;
    expect(total.combinations.kme.average.kind).toBe("value");
    if (total.combinations.kme.average.kind === "value") {
      expect(total.combinations.kme.average.value).toBeCloseTo(2, 8);
    }
  });
});
