import { describe, it, expect } from "vitest";
import { getCurrentAcademicYear } from "../src/utils/academicYear";

describe("getCurrentAcademicYear — 학교 학년도 경계", () => {
  it("1월은 전년도 학년도로 판정한다", () => {
    expect(getCurrentAcademicYear(new Date(2027, 0, 15))).toBe(2026);
  });

  it("2월은 전년도 학년도로 판정한다", () => {
    expect(getCurrentAcademicYear(new Date(2027, 1, 28))).toBe(2026);
  });

  it("3월부터 현재 연도를 학년도로 판정한다", () => {
    expect(getCurrentAcademicYear(new Date(2027, 2, 1))).toBe(2027);
  });

  it("12월은 현재 연도를 학년도로 판정한다", () => {
    expect(getCurrentAcademicYear(new Date(2026, 11, 31))).toBe(2026);
  });
});
