import { describe, it, expect } from "vitest";
import { buildExcelWorkbook } from "../src/export/excelExporter";
import { createEmptyDataFile, generateId } from "../src/models/academic";
import type { StudentDataFile } from "../src/models/academic";

describe("buildExcelWorkbook — 입력한 모든 데이터가 출력에 반영되는지", () => {
  it("모의고사 기록이 01_상담요약 시트에 포함된다 (검수 지적: 이전에는 통째로 누락)", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.mockExams = [
      { id: generateId(), academicYear: 2026, examLabel: "9월", korean: { grade: 2, percentile: 88 }, math: { grade: 3 } },
    ];
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("01_상담요약")!;
    const allText = collectSheetText(ws);
    expect(allText).toContain("모의고사 기록");
    expect(allText).toContain("9월");
  });

  it("모의고사 백분위와 국+수+탐구1 백분위합까지 Excel에 완전히 출력된다 (2차 검수 지적)", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.mockExams = [
      {
        id: generateId(),
        academicYear: 2026,
        examLabel: "9월",
        korean: { grade: 2, percentile: 88 },
        math: { grade: 3, percentile: 91 },
        inquiry1: { grade: 2, percentile: 94 },
        inquiry2: { grade: 3, percentile: 85 },
        koreanHistory: { grade: 1 },
      },
    ];
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("01_상담요약")!;
    const allText = collectSheetText(ws);
    // 백분위 값들이 실제로 셀에 존재해야 한다 (등급만 있고 백분위가 사라지면 안 됨)
    expect(allText).toContain("88");
    expect(allText).toContain("91");
    expect(allText).toContain("94");
    // 국+수+탐구1 백분위합 = 88+91+94 = 273
    expect(allText).toContain("273");
  });

  it("빠른입력 레코드는 02_성적원자료에 '자료구분'이 표시되어 실제 과목처럼 오인되지 않는다", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.academicRecords = [
      {
        id: generateId(),
        academicYear: 2026,
        gradeLevel: 3,
        semester: 1,
        subjectGroup: "국어",
        courseName: "국어 항목1",
        credits: 4,
        evaluationType: "rankGrade",
        gradeScale: 5,
        rankGrade: 2,
        sourceMode: "quickAggregate",
      },
    ];
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("02_성적원자료")!;
    const allText = collectSheetText(ws);
    expect(allText).toContain("빠른입력 누적");
  });

  it("전체 상담메모(notes)가 05_상담메모 시트에 포함된다 (검수 지적: 이전에는 대학별 메모만 출력)", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.notes = "이것은 전체 상담메모 테스트입니다.";
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("05_상담메모")!;
    const allText = collectSheetText(ws);
    expect(allText).toContain("이것은 전체 상담메모 테스트입니다.");
  });

  it("가중평균 값이 문자열이 아니라 숫자로 기록된다 (검수 지적: 정렬·후속계산 편의)", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.academicRecords = [
      {
        id: generateId(),
        academicYear: 2026,
        gradeLevel: 3,
        semester: 1,
        subjectGroup: "국어",
        courseName: "국어1",
        credits: 4,
        evaluationType: "rankGrade",
        gradeScale: 5,
        rankGrade: 2,
      },
    ];
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("01_상담요약")!;
    // "석차등급 산출과목 전교과 가중평균" 행의 값 셀(B열)이 숫자 타입인지 확인
    let found = false;
    ws.eachRow((row) => {
      if (row.getCell(1).value === "석차등급 산출과목 전교과 가중평균") {
        expect(typeof row.getCell(2).value).toBe("number");
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("익명 저장 시 Excel 내용에도 이름이 노출되지 않는다", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.profile = { name: "홍길동", anonymized: true };
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("01_상담요약")!;
    const allText = collectSheetText(ws);
    expect(allText).not.toContain("홍길동");
    expect(allText).toContain("익명");
  });

  it("등급체계 혼재 시 평균 대신 경고 문구가 출력된다", async () => {
    const data: StudentDataFile = createEmptyDataFile();
    data.academicRecords = [
      { id: "a", academicYear: 2026, gradeLevel: 1, semester: 1, subjectGroup: "국어", courseName: "국어1", credits: 4, evaluationType: "rankGrade", gradeScale: 5, rankGrade: 2 },
      { id: "b", academicYear: 2026, gradeLevel: 1, semester: 1, subjectGroup: "수학", courseName: "수학1", credits: 4, evaluationType: "rankGrade", gradeScale: 9, rankGrade: 3 },
    ];
    const wb = await buildExcelWorkbook(data);
    const ws = wb.getWorksheet("01_상담요약")!;
    const allText = collectSheetText(ws);
    expect(allText).toContain("등급체계");
  });
});

function collectSheetText(ws: import("exceljs").Worksheet): string {
  const parts: string[] = [];
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value != null) parts.push(String(cell.value));
    });
  });
  return parts.join(" | ");
}
