import { describe, expect, it } from "vitest";
import {
  parseOfficialTranscriptPositionedPages,
  type PositionedPdfPage,
  type PositionedPdfTextItem,
} from "../src/importers/officialPdfParser";

const item = (x: number, top: number, text: string): PositionedPdfTextItem => ({ x, top, text });

function rankHeader(top: number): PositionedPdfTextItem[] {
  return [
    item(89, top, "학기"), item(136, top, "교과"), item(211, top, "과목"), item(263, top, "학점수"),
    item(296, top - 6, "원점수/과목평균"), item(380, top - 6, "성취도"), item(429, top, "석차등급"), item(482, top, "비고"),
  ];
}

function rankRow(top: number, group: string, course: string, credits: number, grade: number, achievement = "A(180)"): PositionedPdfTextItem[] {
  return [
    item(115, top, group), item(180, top, course), item(272, top, String(credits)),
    item(300, top, "90/70.0(15.0)"), item(379, top, achievement), item(442, top, String(grade)),
  ];
}

function page(pageNumber: number, items: PositionedPdfTextItem[]): PositionedPdfPage {
  return { pageNumber, width: 595, height: 842, items };
}

describe("official positioned school-record parser", () => {
  it("봉사활동을 버리고 rowspan 학기 셀을 이용해 5개 학기를 정확히 분리한다", () => {
    const pages: PositionedPdfPage[] = [
      page(6, [
        item(120, 100, "2024.03.04."), item(230, 100, "(학교)OO고등학교"), item(340, 100, "1학기 시작 대청소"), item(465, 100, "1"),
      ]),
      page(7, [
        item(85, 40, "7. 교과학습발달상황"), item(85, 70, "[1학년]"), ...rankHeader(100), item(95, 150, "1"),
        ...rankRow(122, "국어", "국어", 4, 2), ...rankRow(138, "수학", "수학", 4, 2),
      ]),
      page(8, [
        ...rankHeader(100), item(95, 180, "1"), item(95, 340, "2"),
        ...rankRow(220, "영어", "영어", 4, 2), ...rankRow(240, "과학", "통합과학", 4, 1),
        // 두 학기 마커의 중간점 부근에 첫 2학기 과목이 놓이는 실제 NEIS 형태
        ...rankRow(256, "국어", "국어", 4, 2), ...rankRow(280, "영어", "영어", 4, 3),
      ]),
      page(12, [
        item(85, 50, "[2학년]"), ...rankHeader(100), item(95, 180, "1"),
        ...rankRow(130, "국어", "언어와 매체", 3, 1), ...rankRow(150, "수학", "수학Ⅰ", 3, 2),
        ...rankRow(170, "기술・가정/제2외국어/한문/교양", "중국어Ⅰ", 2, 3, "B(77)"),
      ]),
      page(13, [
        ...rankHeader(100), item(95, 180, "2"),
        ...rankRow(130, "국어", "문학", 4, 3), ...rankRow(150, "영어", "영어Ⅱ", 3, 3),
      ]),
      page(19, [
        item(85, 50, "[3학년]"), ...rankHeader(100), item(95, 180, "1"),
        ...rankRow(130, "국어", "독서", 4, 2), ...rankRow(150, "영어", "영어 독해와 작문", 3, 2),
      ]),
      page(20, [item(85, 50, "8. 독서활동상황")]),
    ];

    const result = parseOfficialTranscriptPositionedPages(pages);
    const rank = result.records.filter((r) => r.evaluationType === "rankGrade");
    const keys = new Set(rank.map((r) => `${r.gradeLevel}-${r.semester}`));

    expect(keys).toEqual(new Set(["1-1", "1-2", "2-1", "2-2", "3-1"]));
    expect(rank.some((r) => r.courseName.includes("2024.03.04"))).toBe(false);
    expect(rank.find((r) => r.courseName === "중국어Ⅰ")?.subjectGroup).toBe("기타");
    expect(rank.find((r) => r.courseName === "영어 독해와 작문")?.subjectGroup).toBe("영어");
    expect(result.warnings).toHaveLength(0);
  });

  it("과학탐구실험처럼 석차등급이 비어 있는 과목은 성취평가로 보존한다", () => {
    const pages = [page(7, [
      item(85, 40, "7. 교과학습발달상황"), item(85, 70, "[1학년]"), ...rankHeader(100), item(95, 150, "1"),
      item(115, 130, "과학"), item(180, 130, "과학탐구실험"), item(272, 130, "1"), item(300, 130, "100/98.5(3.1)"), item(379, 130, "A(191)"),
    ])];
    const result = parseOfficialTranscriptPositionedPages(pages);
    expect(result.records[0]).toMatchObject({ courseName: "과학탐구실험", evaluationType: "achievement", achievement: "A" });
  });
});
