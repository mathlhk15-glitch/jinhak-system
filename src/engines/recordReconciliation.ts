/**
 * 3학년 빠른모드가 어떤 레코드를 "편집 가능"으로 다루고 어떤 레코드를 "그대로 보존"할지
 * 결정하는 순수 함수. UI 코드(grade3QuickMode.ts)에서 분리해 두어 DOM 없이도 테스트할 수 있다.
 *
 * 핵심 원칙 (검수 지적 반영 — P0):
 *   1·2학년 정밀입력(Phase 3)에서 만들어진 레코드(sourceMode: "precise")가 3학년
 *   빠른모드에서 JSON을 불러왔을 때 "국어 항목1" 같은 집계값으로 축소되어 courseId,
 *   실제 학년/학기, rawScore, memo 등 원본 필드가 사라지는 일이 없어야 한다.
 *   빠른모드는 자신이 만든 데이터(sourceMode가 "quickAggregate"이거나 미지정인 구버전
 *   데이터)만 편집하고, precise 데이터는 절대 손대지 않고 그대로 보존한다.
 */

import type { AcademicRecord } from "../models/academic";

export interface SplitRecordsResult {
  /** 빠른모드가 만들었거나(quickAggregate) sourceMode가 없는 구버전 데이터 — 편집 가능 */
  editable: AcademicRecord[];
  /** 정밀입력(precise)으로 만들어진 레코드 — 빠른모드는 절대 수정하지 않고 그대로 보존 */
  preserved: AcademicRecord[];
}

export function splitRecordsBySourceMode(records: AcademicRecord[]): SplitRecordsResult {
  const editable: AcademicRecord[] = [];
  const preserved: AcademicRecord[] = [];
  for (const rec of records) {
    if (rec.sourceMode === "precise") {
      preserved.push(rec);
    } else {
      // sourceMode가 "quickAggregate"이거나, sourceMode 필드가 아예 없는 구버전 데이터
      // (이 필드가 도입되기 전 저장된 파일은 전부 빠른모드 산출물이었으므로 editable이 맞다).
      editable.push(rec);
    }
  }
  return { editable, preserved };
}
