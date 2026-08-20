/**
 * 대학 규칙 데이터 모델 (구조 정의만 — 이번 MVP에서는 실제 데이터를 채우거나
 * UI에서 사용하지 않는다. Phase 3 이후 "대학규칙 DB" 구축 시 이 인터페이스를 사용한다.)
 *
 * 핵심 원칙: 대학명을 코드에 하드코딩하지 않는다 (예: `if (univ === "부산대")` 금지).
 * 모든 반영교과/학년가중치/성취평가 처리/수능최저 규칙은 데이터로 표현하고,
 * 프로그램은 그 데이터를 "읽어서 판정"하는 역할만 한다.
 */

export interface UniversityMaster {
  universityId: string; // 예: "U0001" — 표시명이 바뀌어도 유지
  standardName: string; // 예: "부산대학교"
  aliases?: string[]; // 예: ["부산대"]
}

export interface MajorMaster {
  majorId: string; // 예: "M0001"
  universityId: string;
  majorName: string;
}

export type TranscriptRule = unknown; // Phase 3+: 반영교과·학년비율·상위N과목 등 세부 스키마 정의
export type AchievementRule = unknown; // Phase 3+: 성취평가(A~E) 처리 방식
export type CsatMinimumRule = unknown; // Phase 3+: 수능최저 조건 표현식

export type VerificationStatus = "verified" | "reviewRequired" | "unverified";

export interface UniversityRule {
  ruleId: string;
  admissionYear: number;

  universityId: string;
  majorId?: string;
  admissionId: string; // 예: "A2027_0001"

  transcriptRule?: TranscriptRule;
  achievementRule?: AchievementRule;
  csatMinimumRule?: CsatMinimumRule;

  /** 사람이 override한 경우 기록 (자동계산값과 별개로 보관) */
  manualOverride?: {
    value: number | string;
    reason: string;
    overriddenAt: string;
    overriddenBy?: string;
  };

  calculationMode?: "auto" | "reviewRequired" | "manual";

  source?: string;
  verifiedAt?: string;
  verificationStatus?: VerificationStatus;

  memo?: string;
}
