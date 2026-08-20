import { describe, it, expect } from "vitest";
import { prepareForExport, exportToJsonString, parseAndMigrate } from "../src/storage/jsonBackup";
import { createEmptyDataFile } from "../src/models/academic";

describe("prepareForExport — 익명 저장이 실제로 개인정보를 제거하는지", () => {
  it("anonymized가 true면 이름과 학번이 내보내기 데이터에서 사라진다", () => {
    const data = createEmptyDataFile();
    data.profile = { name: "홍길동", studentId: "20301", anonymized: true, gradeLevel: 3 };

    const exportable = prepareForExport(data);
    expect(exportable.profile.name).toBeUndefined();
    expect(exportable.profile.studentId).toBeUndefined();
    expect(exportable.profile.gradeLevel).toBe(3); // 학년 정보는 개인식별정보가 아니므로 유지
  });

  it("JSON 문자열로 직렬화했을 때도 이름이 포함되지 않는다", () => {
    const data = createEmptyDataFile();
    data.profile = { name: "홍길동", anonymized: true };
    const exportable = prepareForExport(data);
    const json = exportToJsonString(exportable);
    expect(json).not.toContain("홍길동");
  });

  it("anonymized가 false면 원래 데이터가 그대로 보존된다", () => {
    const data = createEmptyDataFile();
    data.profile = { name: "홍길동", anonymized: false };
    const exportable = prepareForExport(data);
    expect(exportable.profile.name).toBe("홍길동");
  });

  it("익명 저장된 JSON을 다시 불러와도 정상적으로 파싱된다 (이름 없이도 유효한 구조)", () => {
    const data = createEmptyDataFile();
    data.profile = { name: "홍길동", anonymized: true };
    const exportable = prepareForExport(data);
    const json = exportToJsonString(exportable);
    const result = parseAndMigrate(json);
    expect(result.data.profile.name).toBeUndefined();
    expect(result.data.profile.anonymized).toBe(true);
  });
});
