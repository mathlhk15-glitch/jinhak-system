/**
 * 공통 성적 계산 엔진
 *
 * 핵심 원칙 (절대 위반 금지):
 *  1. 가중평균 = Σ(단위수 × 등급) ÷ Σ단위수  — 항상 evaluationType === "rankGrade" 인
 *     과목만 포함한다. achievement(A~E) 과목은 절대 숫자로 환산해 섞지 않는다.
 *  2. 분모가 0이면 NaN/Infinity를 반환하지 않고 명시적으로 "데이터 없음" 상태를 반환한다.
 *  3. 서로 다른 gradeScale(5등급제/9등급제)의 rankGrade를 임의 환산해 하나로 합치지 않는다.
 *     혼재가 감지되면 평균 자체를 계산하지 않고 "값 없음" + 경고를 반환한다(원자료는 보존).
 *  4. UI 입력검증(min/max 속성)은 사용자 편의를 위한 것일 뿐 신뢰하지 않는다. JSON 불러오기
 *     등 UI를 거치지 않고 들어온 값도 있을 수 있으므로, 이 엔진이 최종 방어선으로서 범위를
 *     벗어난 rankGrade(예: 5등급제인데 8등급)를 반드시 계산에서 제외한다(검수 지적 반영).
 */

import type { AcademicRecord, AchievementLevel } from "../models/academic";

/** 과목 1건(한 줄 입력)의 단위수 상한. UI(utils/validation.ts)와 반드시 같은 값을 써야 한다
 *  (검수 지적: 이전에는 UI가 21단위를 "비정상"이라고 표시하면서도 계산엔진은 그대로
 *  포함시키던 불일치가 있었다). 학기 하나에 한 과목이 8단위를 넘는 경우는 실질적으로 없고,
 *  이 값은 "누적 총단위"가 아니라 "한 항목(한 학기 한 과목)"에 대한 상한이다. */
export const MAX_CREDITS_PER_RECORD = 20;

/** 계산 결과에서 "값 없음"을 표현하는 명시적 상태. NaN/Infinity 대신 이것을 사용한다. */
export type ComputedValue =
  | { kind: "value"; value: number }
  | { kind: "empty" }; // 표시할 때 "-" 또는 "입력 없음"으로 렌더링

export interface InvalidCourseInfo {
  courseName: string;
  reason: string;
}

export interface WeightedAverageResult {
  average: ComputedValue;
  /** 계산에 실제 사용된 석차등급 체계. 데이터 없음/혼재 시 null */
  gradeScale: 5 | 9 | null;
  totalCredits: number;
  courseCount: number;
  /** 계산에 포함된 과목 목록 (근거 표시용) */
  includedCourses: { courseName: string; credits: number; rankGrade: number }[];
  /** 계산에서 제외된 성취평가 과목 (별도 표시용, 평균에 영향 없음) */
  excludedAchievementCourses: { courseName: string; credits: number; achievement: AchievementLevel }[];
  /** 값 범위를 벗어나 계산에서 제외된 rankGrade 과목 (예: 5등급제인데 8등급 입력).
   *  침묵하며 버리지 않고 사유와 함께 반환해 화면에서 "N건 제외됨"으로 안내할 수 있게 한다. */
  invalidCourses: InvalidCourseInfo[];
  /** 서로 다른 gradeScale이 섞여 있으면 경고 */
  mixedGradeScaleWarning: boolean;
}

const EMPTY: ComputedValue = { kind: "empty" };

export function value(v: number): ComputedValue {
  if (!isFinite(v) || isNaN(v)) return EMPTY;
  return { kind: "value", value: v };
}

export function isEmpty(v: ComputedValue): v is { kind: "empty" } {
  return v.kind === "empty";
}

/** 화면 표시용 포맷. 값이 없으면 "-" 반환 (NaN/Infinity/#DIV/0! 절대 노출 금지) */
export function formatGrade(v: ComputedValue, digits = 2): string {
  if (isEmpty(v)) return "-";
  return v.value.toFixed(digits);
}

/** rankGrade 과목 1건이 계산에 포함될 자격이 있는지 최종 판정한다.
 *  UI가 무엇을 표시했든, 이 조건을 통과하지 못하면 절대 평균에 반영하지 않는다.
 *  export하는 이유: getActiveGradeScale()도 "평균 계산에 실제로 포함될 과목"과
 *  완전히 동일한 기준으로 등급체계를 판단해야 하기 때문이다(검수 지적 반영 — 두 함수의
 *  판정 기준이 어긋나면, 예를 들어 잘못된 9등급 데이터 하나 때문에 나머지 정상적인
 *  5등급제 데이터의 목표등급 계산까지 "혼재"로 오판해 막아버리는 문제가 생긴다). */
export function isCalculableRankGradeCourse(r: AcademicRecord): { ok: true } | { ok: false; reason: string } {
  if (r.credits == null || !Number.isFinite(r.credits) || r.credits <= 0) {
    return { ok: false, reason: "단위수 없음" };
  }
  if (r.credits > MAX_CREDITS_PER_RECORD) {
    return { ok: false, reason: `단위수 범위 초과(${r.credits}단위, 최대 ${MAX_CREDITS_PER_RECORD})` };
  }
  if (r.gradeScale !== 5 && r.gradeScale !== 9) {
    return { ok: false, reason: "등급체계 미지정" };
  }
  if (r.rankGrade == null || !Number.isFinite(r.rankGrade)) {
    return { ok: false, reason: "등급 없음" };
  }
  if (r.rankGrade < 1 || r.rankGrade > r.gradeScale) {
    return { ok: false, reason: `등급 범위 초과(${r.gradeScale}등급제에 ${r.rankGrade}등급)` };
  }
  return { ok: true };
}

/**
 * 단위수 가중평균 계산.
 * records는 이미 원하는 범위(특정 교과군, 특정 학년, 특정 조합 등)로 필터링된 상태로 전달한다.
 * → 이 함수 자체는 "필터링된 원자료 집합에 대한 가중평균"만 책임진다 (단일 책임 원칙).
 */
export function computeWeightedAverage(records: AcademicRecord[]): WeightedAverageResult {
  const rankGradeCandidates = records.filter((r) => r.evaluationType === "rankGrade");
  const achievementCourses = records.filter(
    (r) => r.evaluationType === "achievement" && r.achievement != null
  );

  const rankGradeCourses: AcademicRecord[] = [];
  const invalidCourses: InvalidCourseInfo[] = [];
  for (const r of rankGradeCandidates) {
    const check = isCalculableRankGradeCourse(r);
    if (check.ok) {
      rankGradeCourses.push(r);
    } else if ("reason" in check) {
      invalidCourses.push({ courseName: r.courseName, reason: check.reason });
    }
  }

  const scalesUsed = new Set(rankGradeCourses.map((r) => r.gradeScale).filter((s) => s != null));
  const mixedGradeScaleWarning = scalesUsed.size > 1;

  const excluded: WeightedAverageResult["excludedAchievementCourses"] = achievementCourses.map((r) => ({
    courseName: r.courseName,
    credits: r.credits,
    achievement: r.achievement as AchievementLevel,
  }));

  // 원칙: 5등급제와 9등급제 성적을 임의 환산해 하나의 공식 평균으로 절대 섞지 않는다.
  // 혼재가 감지되면 평균 자체를 계산하지 않고 명시적으로 "값 없음" + 경고를 반환한다.
  if (mixedGradeScaleWarning) {
    return {
      average: EMPTY,
      gradeScale: null,
      totalCredits: rankGradeCourses.reduce((sum, r) => sum + r.credits, 0),
      courseCount: 0,
      includedCourses: [],
      excludedAchievementCourses: excluded,
      invalidCourses,
      mixedGradeScaleWarning: true,
    };
  }

  let creditSum = 0;
  let scoreSum = 0;
  const included: WeightedAverageResult["includedCourses"] = [];

  for (const r of rankGradeCourses) {
    creditSum += r.credits;
    scoreSum += r.credits * (r.rankGrade as number);
    included.push({ courseName: r.courseName, credits: r.credits, rankGrade: r.rankGrade as number });
  }

  const average = creditSum > 0 ? value(scoreSum / creditSum) : EMPTY;
  const activeScale = scalesUsed.size === 1 ? ([...scalesUsed][0] as 5 | 9) : null;

  return {
    average,
    gradeScale: activeScale,
    totalCredits: creditSum,
    courseCount: included.length,
    includedCourses: included,
    excludedAchievementCourses: excluded,
    invalidCourses,
    mixedGradeScaleWarning: false,
  };
}

/** 교과군별 결과 묶음 */
export interface SubjectGroupBreakdown {
  subjectGroup: string;
  result: WeightedAverageResult;
}

export function computeBySubjectGroup(records: AcademicRecord[]): SubjectGroupBreakdown[] {
  const groups = new Map<string, AcademicRecord[]>();
  for (const r of records) {
    const key = r.subjectGroup || "기타";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return Array.from(groups.entries()).map(([subjectGroup, recs]) => ({
    subjectGroup,
    result: computeWeightedAverage(recs),
  }));
}

/**
 * 특정 교과군 조합(예: 국수영사과)에 대한 가중평균.
 * 수학적으로 "교과군별 가중평균을 다시 가중평균" 하는 것과
 * "전체 과목을 한 번에 가중평균" 하는 것은 동일한 값이므로(Σ 분배법칙),
 * 여기서는 단순하고 오차가 없는 방식(전체 과목 flat 가중평균)을 사용한다.
 */
export function computeCombination(records: AcademicRecord[], subjectGroups: string[]): WeightedAverageResult {
  const set = new Set(subjectGroups);
  const filtered = records.filter((r) => set.has(r.subjectGroup));
  return computeWeightedAverage(filtered);
}

/** 단순평균(참고값). 단위수를 무시한 산술평균 — 절대 핵심 지표로 쓰지 않는다. */
export function computeSimpleAverageReference(records: AcademicRecord[]): ComputedValue {
  const grades = records
    .filter((r) => r.evaluationType === "rankGrade" && r.rankGrade != null)
    .map((r) => r.rankGrade as number);
  if (grades.length === 0) return EMPTY;
  return value(grades.reduce((a, b) => a + b, 0) / grades.length);
}

/**
 * 유효한 rankGrade 과목들이 사용하는 등급체계가 단일하면 그 값을, 데이터가 없거나
 * 혼재되어 있으면 null을 반환한다. 목표등급 계산 등에서 "화면 상단의 기본 선택값"이
 * 아니라 "실제 성적 데이터가 어떤 등급체계인지"를 근거로 판단해야 할 때 사용한다
 * (검수 지적: 전역 기본값과 실제 데이터의 등급체계가 다를 수 있는데 계산은 전역값을 썼던 문제).
 *
 * "실제로 평균 계산에 포함되는 과목"과 동일한 기준(isCalculableRankGradeCourse)으로
 * 등급체계를 판단한다 — 등급값 자체가 범위를 벗어나 애초에 계산에서 제외될 과목(예: 9등급제인데
 * 99등급)이 하나 섞여 있다고 해서, 나머지 정상적인 5등급제 데이터까지 "혼재"로 오판해
 * 목표등급 계산을 막아버리는 일이 없도록 한다 (검수 지적 반영).
 */
export function getActiveGradeScale(records: AcademicRecord[]): 5 | 9 | null {
  const scales = new Set(
    records.filter((r) => r.evaluationType === "rankGrade" && isCalculableRankGradeCourse(r).ok).map((r) => r.gradeScale)
  );
  if (scales.size !== 1) return null;
  return [...scales][0] as 5 | 9;
}
