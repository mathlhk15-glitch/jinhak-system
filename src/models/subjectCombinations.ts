/**
 * 학생 상담용 공통 교과 조합.
 * 대학별 실제 반영규칙과는 별개이며, 현재 성적의 위치를 빠르게 비교하기 위한 공통 지표다.
 * 모든 값은 과목별 단위수를 반영한 가중평균으로 계산한다.
 */

export interface SubjectCombinationDef {
  id: string;
  label: string;
  subjectGroups: string[];
}

export const REFERENCE_COMBINATIONS: SubjectCombinationDef[] = [
  { id: "kme", label: "국영수", subjectGroups: ["국어", "영어", "수학"] },
  { id: "kmes", label: "국영수사", subjectGroups: ["국어", "영어", "수학", "사회"] },
  { id: "kmec", label: "국영수과", subjectGroups: ["국어", "영어", "수학", "과학"] },
  { id: "kmesc", label: "국영수사과", subjectGroups: ["국어", "영어", "수학", "사회", "과학"] },
];
