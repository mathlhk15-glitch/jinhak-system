import type { GradeScale } from "../models/academic";
import { MAX_CREDITS_PER_RECORD } from "../engines/gradeEngine";

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export function validateCredits(credits: number): ValidationResult {
  if (credits == null || isNaN(credits)) return { valid: true }; // 빈 값은 허용(미입력으로 취급)
  if (credits < 0) return { valid: false, message: "단위수는 0 이상이어야 합니다." };
  if (credits > MAX_CREDITS_PER_RECORD) {
    return { valid: false, message: `단위수가 비정상적으로 큽니다(최대 ${MAX_CREDITS_PER_RECORD}). 확인해 주세요.` };
  }
  return { valid: true };
}

export function validateRankGrade(grade: number, gradeScale: GradeScale = 5): ValidationResult {
  if (grade == null || isNaN(grade)) return { valid: true };
  if (grade < 1 || grade > gradeScale) {
    return { valid: false, message: `등급은 1~${gradeScale} 사이여야 합니다.` };
  }
  return { valid: true };
}

export function validateTargetGrade(target: number, gradeScale: GradeScale = 5): ValidationResult {
  return validateRankGrade(target, gradeScale);
}

/** 모의고사 등급은 내신 gradeScale과 무관하게 항상 1~9 범위. */
export function validateMockExamGrade(grade: number): ValidationResult {
  if (grade == null || isNaN(grade)) return { valid: true };
  if (grade < 1 || grade > 9) return { valid: false, message: "모의고사 등급은 1~9 사이여야 합니다." };
  return { valid: true };
}

export function validatePercentile(pct: number): ValidationResult {
  if (pct == null || isNaN(pct)) return { valid: true };
  if (pct < 0 || pct > 100) return { valid: false, message: "백분위는 0~100 사이여야 합니다." };
  return { valid: true };
}

export function validateNonNegativeInteger(n: number, label: string): ValidationResult {
  if (n == null || isNaN(n)) return { valid: true };
  if (n < 0) return { valid: false, message: `${label}은(는) 0 이상이어야 합니다.` };
  if (!Number.isInteger(n)) return { valid: false, message: `${label}은(는) 정수여야 합니다.` };
  return { valid: true };
}

export function validateNonNegativeNumber(n: number, label: string): ValidationResult {
  if (n == null || isNaN(n)) return { valid: true };
  if (n < 0) return { valid: false, message: `${label}은(는) 0 이상이어야 합니다.` };
  return { valid: true };
}

/** 대학 입결 조사 연도 등에 사용. 합리적인 4자리 연도 범위만 허용한다. */
export function validateYear(year: number): ValidationResult {
  if (year == null || isNaN(year)) return { valid: false, message: "연도를 입력해 주세요." };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { valid: false, message: "연도는 2000~2100 사이의 정수여야 합니다." };
  }
  return { valid: true };
}
