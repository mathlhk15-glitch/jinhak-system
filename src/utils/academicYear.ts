/**
 * 대한민국 학교 학년도 기준 현재 학년도를 반환한다.
 * 학교 학년도는 3월에 시작하므로 1~2월은 전년도 학년도로 본다.
 *
 * 예:
 *  - 2027-01-15 -> 2026학년도
 *  - 2027-02-28 -> 2026학년도
 *  - 2027-03-01 -> 2027학년도
 */
export function getCurrentAcademicYear(date = new Date()): number {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0=1월, 1=2월, 2=3월
  return month < 2 ? year - 1 : year;
}
