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

});
