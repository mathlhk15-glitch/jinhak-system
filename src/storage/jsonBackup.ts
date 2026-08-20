/**
 * JSON 내보내기/불러오기 — 학생 데이터의 "진짜" 장기 보존 수단.
 * (IndexedDB는 현재 기기 자동저장용 보조 수단일 뿐이다.)
 */

import type { StudentDataFile } from "../models/academic";
import { migrateToCurrent } from "./migrations";
import { normalizeStudentDataFile } from "./normalize";

export function exportToJsonString(data: StudentDataFile): string {
  const toSave: StudentDataFile = {
    ...data,
    metadata: { ...data.metadata, updatedAt: new Date().toISOString() },
  };
  return JSON.stringify(toSave, null, 2);
}

/**
 * 익명 저장이 켜져 있으면 실제로 개인식별정보(이름·학번)를 파일 내용에서
 * 제거한 사본을 만든다. (검수 지적: 이전에는 파일명만 "익명_..."으로 바꾸고
 * JSON 본문에는 이름이 그대로 남아 있던 버그가 있었다.)
 */
export function prepareForExport(data: StudentDataFile): StudentDataFile {
  if (!data.profile.anonymized) return data;
  return {
    ...data,
    profile: {
      ...data.profile,
      name: undefined,
      studentId: undefined,
    },
  };
}

export function downloadJsonFile(data: StudentDataFile, filename?: string): void {
  const exportable = prepareForExport(data);
  const json = exportToJsonString(exportable);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const namePart = exportable.profile.anonymized ? "익명" : exportable.profile.name || "학생";
  a.href = url;
  a.download = filename ?? `${namePart}_진학설계_${dateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

export interface ImportResult {
  data: StudentDataFile;
  wasMigrated: boolean;
  appliedMigrations: string[];
}

/**
 * 파일 내용을 읽어 현재 스키마로 마이그레이션한 뒤, 런타임 정규화까지 적용해 반환한다.
 * (검수 지적 반영: `as StudentDataFile` 캐스팅만으로는 필드 누락·손상된 파일을
 * 막을 수 없으므로, 마이그레이션 이후 반드시 normalizeStudentDataFile을 거친다.)
 */
export function parseAndMigrate(jsonText: string): ImportResult {
  let raw: any;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("올바른 JSON 파일이 아닙니다. 파일이 손상되었을 수 있습니다.");
  }
  const outcome = migrateToCurrent(raw);
  const normalized = normalizeStudentDataFile(outcome.data);
  return {
    data: normalized,
    wasMigrated: outcome.appliedMigrations.length > 0,
    appliedMigrations: outcome.appliedMigrations,
  };
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}
