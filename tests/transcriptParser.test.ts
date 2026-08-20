import { describe, expect, it } from "vitest";
import { parseTranscriptText } from "../src/importers/transcriptParser";

describe("transcript parser", () => {
  it("학년/학기/교과/단위수/등급을 추출한다", () => {
    const text = [
      "1학년 1학기",
      "국어\t공통국어1\t4\t85\t70\tA\t2",
      "수학\t공통수학1\t4\t90\t75\tA\t1",
      "1학년 2학기",
      "영어\t공통영어1\t3\t88\t72\t2",
    ].join("\n");
    const result = parseTranscriptText(text);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({ gradeLevel: 1, semester: 1, subjectGroup: "국어", credits: 4, rankGrade: 2 });
    expect(result.records[2]).toMatchObject({ gradeLevel: 1, semester: 2, subjectGroup: "영어", credits: 3, rankGrade: 2 });
  });

  it("과목명 속 숫자를 단위수로 오인하지 않는다", () => {
    const result = parseTranscriptText("1 1 국어 공통국어1 4 2");
    expect(result.records[0]).toMatchObject({ courseName: "공통국어1", credits: 4, rankGrade: 2 });
  });

  it("행 병합된 생기부 표에서 숫자형 학년/학기 문맥을 후속 행에 상속한다", () => {
    const text = [
      "1\t1\t국어\t국어\t4\t2",
      "수학\t수학\t4\t1",
      "2\t영어\t영어Ⅰ\t3\t2",
      "국어\t문학\t4\t3",
      "2\t1\t국어\t독서\t4\t2",
      "수학\t수학Ⅰ\t4\t2",
      "2\t사회\t사회·문화\t3\t3",
      "과학\t생명과학Ⅰ\t3\t2",
      "3\t1\t국어\t화법과 작문\t4\t2",
    ].join("\n");

    const result = parseTranscriptText(text);
    const count = (gradeLevel: number, semester: number) =>
      result.records.filter((r) => r.gradeLevel === gradeLevel && r.semester === semester).length;

    expect(count(1, 1)).toBe(2);
    expect(count(1, 2)).toBe(2);
    expect(count(2, 1)).toBe(2);
    expect(count(2, 2)).toBe(2);
    expect(count(3, 1)).toBe(1);
    expect(result.warnings.some((w) => w.includes("성적이 인식되지 않았습니다"))).toBe(false);
  });

  it("학교생활기록부II 전체 PDF에서 교과학습발달상황만 읽고 5개 학기를 구분한다", () => {
    const text = [
      "6. 창의적 체험활동상황",
      "2024.03.04. (학교)OO고등학교 1학기 시작을 위한 학교 대청소 1 1",
      "2024.04.16. - 2025.02.03. (학교)OO고등학교 디지털 리터러시 교육 캠페인 활동 8 9",
      "7. 교과학습발달상황",
      "[1학년]",
      "학기\t교과\t과목\t학점수\t원점수/과목평균\t성취도\t석차등급\t비고",
      "1",
      "국어\t국어\t4\t94/77.3(13.8)\tA(191)\t2",
      "수학\t수학\t4\t88/71.2(10.4)\tA(191)\t2",
      "영어\t영어\t4\t93/62.9(19.5)\tA(191)\t2",
      "사회(역사/도덕 포함)\t통합사회\t3\t88/76.1(14.6)\tB(191)\t3",
      "과학\t통합과학\t4\t95/78.6(13.4)\tA(191)\t1",
      "기술・가정/제2외국어/한문/교양\t정보\t3\t87/62.2(15.8)\tA(191)\t2",
      "2",
      "국어\t국어\t4\t96/77.1(12.8)\tA(186)\t2",
      "수학\t수학\t4\t91/73.1(12.2)\tA(186)\t2",
      "영어\t영어\t4\t90/65.6(20.6)\tA(186)\t3",
      "사회(역사/도덕 포함)\t통합사회\t3\t86/73.2(18.4)\tB(186)\t4",
      "과학\t통합과학\t4\t99/79.0(15.0)\tA(186)\t1",
      "기술・가정/제2외국어/한문/교양\t한문Ⅰ\t3\t73/62.9(17.7)\tB(186)\t4",
      "이수학점 합계 48",
      "[2학년]",
      "학기\t교과\t과목\t학점수\t원점수/과목평균\t성취도\t석차등급\t비고",
      "1",
      "국어\t언어와 매체\t3\t98/70.3(14.0)\tA(182)\t1",
      "수학\t수학Ⅰ\t3\t95/63.7(15.3)\tA(182)\t2",
      "영어\t영어Ⅰ\t3\t90/62.9(18.9)\tA(182)\t2",
      "2",
      "국어\t문학\t4\t86/72.0(15.0)\tA(182)\t3",
      "수학\t수학Ⅱ\t3\t96/63.6(15.4)\tA(182)\t1",
      "영어\t영어Ⅱ\t3\t86/60.0(19.6)\tA(182)\t3",
      "이수학점 합계 44",
      "[3학년]",
      "학기\t교과\t과목\t학점수\t원점수/과목평균\t성취도\t석차등급\t비고",
      "1",
      "국어\t독서\t4\t92/69.0(19.1)\tA(175)\t2",
      "수학\t미적분\t3\t92/67.5(15.4)\tA(94)\t2",
      "한국사\t한국사\t1\t92/74.1(16.6)\tA(175)\t3",
      "영어\t영어 독해와 작문\t3\t94/64.6(15.8)\tA(175)\t2",
      "이수학점 합계 11",
      "8. 독서활동상황",
      "1 국어 (2학기) 하얼빈",
    ].join("\n");

    const result = parseTranscriptText(text);
    const rank = result.records.filter((r) => r.evaluationType === "rankGrade");
    const count = (g: number, sem: number) => rank.filter((r) => r.gradeLevel === g && r.semester === sem).length;

    expect(count(1, 1)).toBe(6);
    expect(count(1, 2)).toBe(6);
    expect(count(2, 1)).toBe(3);
    expect(count(2, 2)).toBe(3);
    expect(count(3, 1)).toBe(4);
    expect(rank.some((r) => r.courseName.includes("2024.03.04"))).toBe(false);
    expect(rank.some((r) => r.courseName === "국어")).toBe(true);
    expect(result.warnings.some((w) => w.includes("성적이 인식되지 않았습니다"))).toBe(false);
  });

  it("좌표 주입 학기 태그와 실제 생기부 핵심 행을 5개 학기로 정확히 분류한다", () => {
    const text = [
      "봉 사 활 동 실 적",
      "2024.03.04. (학교)OO고등학교 1학기 시작을 위한 학교 대청소 1 1",
      "7. 교과학습발달상황",
      "[1학년]",
      "학기\t교과\t과목\t학점수\t성취도\t석차등급",
      "[[SEM:1]]\t국어\t국어\t4\t94/77.3(13.8)\tA(191)\t2",
      "[[SEM:1]]\t외국어/한문/교\t정보\t3\t87/62.2(15.8)\tA(191)\t2",
      "[[SEM:2]]\t국어\t국어\t4\t96/77.1(12.8)\tA(186)\t2",
      "[[SEM:2]]\t외국어/한문/교\t한문Ⅰ\t3\t73/62.9(17.7)\tB(186)\t4",
      "[2학년]",
      "학기\t교과\t과목\t학점수\t성취도\t석차등급",
      "[[SEM:1]]\t국어\t언어와 매체\t3\tA(182)\t1",
      "[[SEM:1]]\t외국어/한문/교\t중국어Ⅰ\t2\tB(77)\t3",
      "[[SEM:2]]\t국어\t문학\t4\tA(182)\t3",
      "[[SEM:2]]\t영어\t영어Ⅱ\t3\tA(182)\t3",
      "[3학년]",
      "학기\t교과\t과목\t학점수\t성취도\t석차등급",
      "[[SEM:1]]\t국어\t독서\t4\tA(175)\t2",
      "[[SEM:1]]\t영어\t영어 독해와 작문\t3\tA(175)\t2",
      "8. 독서활동상황",
    ].join("\n");

    const result = parseTranscriptText(text);
    const rank = result.records.filter((r) => r.evaluationType === "rankGrade");
    const keys = new Set(rank.map((r) => `${r.gradeLevel}-${r.semester}`));
    expect(keys).toEqual(new Set(["1-1", "1-2", "2-1", "2-2", "3-1"]));
    expect(rank.find((r) => r.courseName === "정보")?.subjectGroup).toBe("정보");
    expect(rank.find((r) => r.courseName === "중국어Ⅰ")?.subjectGroup).toBe("기타");
    expect(rank.find((r) => r.courseName === "영어 독해와 작문")?.subjectGroup).toBe("영어");
    expect(rank.some((r) => r.courseName.includes("대청소"))).toBe(false);
  });

});
