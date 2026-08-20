/**
 * "참고용 교과 조합" 정의 — UI(grade3QuickMode.ts)와 Excel(excelExporter.ts)이
 * 반드시 이 배열 하나만 참조하도록 통일한다. (검수 지적: 두 곳에 같은 배열이
 * 중복되어 있으면 한쪽만 수정 시 웹/Excel 결과가 달라질 수 있음)
 *
 * 주의: 이 조합들은 아직 실제 대학규칙 DB와 연결된 값이 아니라 참고용 범용
 * 조합이다(대학명을 코드에 하드코딩하지 않는다는 원칙에 따름). Phase 3에서
 * 대학규칙 DB가 생기면 대학별로 정확한 조합이 자동 결정되도록 대체될 예정이다.
 */

export interface SubjectCombinationDef {
  id: string;
  label: string;
  subjectGroups: string[];
}

export const REFERENCE_COMBINATIONS: SubjectCombinationDef[] = [
  { id: "core5", label: "국수영사과", subjectGroups: ["국어", "수학", "영어", "사회", "과학"] },
  {
    id: "core5_history",
    label: "국수영사과+한국사",
    subjectGroups: ["국어", "수학", "영어", "사회", "과학", "한국사"],
  },
];
