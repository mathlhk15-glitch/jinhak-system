import { describe, expect, it } from "vitest";
import {
  convertFiveGradeAverageToNine,
  convertGradeAverageToNine,
  convertWeightedAverageToNine,
} from "../src/engines/gradeConversion";
import { computeWeightedAverage, value } from "../src/engines/gradeEngine";
import type { AcademicRecord } from "../src/models/academic";

describe("5등급 → 9등급 환산 — 제공 Excel VLOOKUP 기준", () => {
  it("환산표의 정확한 기준점을 그대로 재현한다", () => {
    expect(convertFiveGradeAverageToNine(1)).toBe(1.2);
    expect(convertFiveGradeAverageToNine(1.01)).toBe(1.25);
    expect(convertFiveGradeAverageToNine(2.03)).toBe(3.47);
    expect(convertFiveGradeAverageToNine(3)).toBe(4.93);
    expect(convertFiveGradeAverageToNine(4.21)).toBe(6.91);
  });

  it("Excel VLOOKUP 근사검색처럼 조회값 이하의 가장 가까운 기준점을 사용한다", () => {
    expect(convertFiveGradeAverageToNine(1.13)).toBe(1.35); // 1.02 구간
    expect(convertFiveGradeAverageToNine(2)).toBe(3.46); // 1.99 구간
    expect(convertFiveGradeAverageToNine(4)).toBe(6.38); // 3.95 구간
    expect(convertFiveGradeAverageToNine(5)).toBe(6.91); // 표의 마지막 구간 유지
  });

  it("5등급 유효범위 밖 값은 환산하지 않는다", () => {
    expect(convertFiveGradeAverageToNine(0.99)).toBeNull();
    expect(convertFiveGradeAverageToNine(5.01)).toBeNull();
    expect(convertFiveGradeAverageToNine(Number.NaN)).toBeNull();
  });

  it("이미 9등급제인 값은 원값을 그대로 9등급 값으로 표시한다", () => {
    const converted = convertGradeAverageToNine(value(3.25), 9);
    expect(converted).toEqual({ kind: "value", value: 3.25 });
  });

  it("5등급제 단위수 가중평균 결과도 환산한다", () => {
    const records: AcademicRecord[] = [
      {
        id: "a",
        academicYear: 2026,
        gradeLevel: 1,
        semester: 1,
        subjectGroup: "국어",
        courseName: "국어",
        credits: 4,
        evaluationType: "rankGrade",
        gradeScale: 5,
        rankGrade: 1,
      },
      {
        id: "b",
        academicYear: 2026,
        gradeLevel: 1,
        semester: 1,
        subjectGroup: "수학",
        courseName: "수학",
        credits: 4,
        evaluationType: "rankGrade",
        gradeScale: 5,
        rankGrade: 3,
      },
    ];
    const result = computeWeightedAverage(records); // 2.00
    expect(result.gradeScale).toBe(5);
    expect(convertWeightedAverageToNine(result)).toEqual({ kind: "value", value: 3.46 });
  });
});
