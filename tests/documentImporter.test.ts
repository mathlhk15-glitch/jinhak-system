import { describe, expect, it } from "vitest";
import { injectSemesterByGeometry } from "../src/importers/documentImporter";

type L = { y: number; items: Array<{ x: number; text: string }>; text: string };
const line = (y: number, items: Array<[number, string]>): L => ({
  y,
  items: items.map(([x, text]) => ({ x, text })),
  text: items.map(([, text]) => text).join("\t"),
});

describe("PDF semester geometry", () => {
  it("rowspan 학기 숫자가 과목행 사이에 있어도 1/2학기를 좌표로 구분한다", () => {
    // 실제 학교생활기록부 PDF와 같은 형태: 1학기 마커와 2학기 마커가
    // 각각 여러 과목 행의 세로 중앙에 놓인다.
    const lines: L[] = [
      line(600, [[115, "영어"], [181, "영어"], [272, "4"], [379, "A(191)"], [442, "2"]]),
      line(530, [[95, "1"]]),
      line(474, [[115, "정보"], [272, "3"], [379, "A(191)"], [442, "2"]]),
      line(447, [[115, "국어"], [181, "국어"], [272, "4"], [379, "A(186)"], [442, "2"]]),
      line(364, [[95, "2"]]),
      line(350, [[115, "수학"], [181, "수학"], [272, "4"], [379, "A(186)"], [442, "2"]]),
    ];
    const result = injectSemesterByGeometry(lines as any);
    expect(result.find((x) => x.includes("\t정보\t"))).toMatch(/^\[\[SEM:1\]\]/);
    expect(result.find((x) => x.includes("\t국어\t국어\t"))).toMatch(/^\[\[SEM:2\]\]/);
    expect(result.find((x) => x.includes("\t수학\t수학\t"))).toMatch(/^\[\[SEM:2\]\]/);
  });

  it("학기 숫자가 과목행과 같은 y행에 합쳐져도 마커로 사용한다", () => {
    const lines: L[] = [
      line(500, [[115, "국어"], [181, "언어와 매체"], [272, "3"], [379, "A(182)"], [442, "1"]]),
      line(450, [[95, "1"], [115, "과학"], [181, "화학Ⅰ"], [272, "2"], [381, "A(92)"], [442, "2"]]),
      line(400, [[115, "중국어Ⅰ"], [272, "2"], [381, "B(77)"], [442, "3"]]),
    ];
    const result = injectSemesterByGeometry(lines as any);
    expect(result.filter((x) => x.startsWith("[[SEM:1]]"))).toHaveLength(3);
  });
});
