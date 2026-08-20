/**
 * 스키마 버전 마이그레이션 레지스트리.
 *
 * 원칙:
 *  - 원본 JSON을 직접 변경하지 않는다. 항상 깊은 복사본을 만든 뒤 변환한다.
 *  - 구버전 파일이 들어오면 현재 버전(CURRENT_SCHEMA_VERSION)까지 순차 변환한다.
 *  - 각 마이그레이션은 "fromVersion -> toVersion" 함수로 등록한다.
 *
 * 데모용 실제 마이그레이션: 0.9 -> 1.0
 *   v0.9(가상의 이전 프로토타입)에서는 academicRecords가 evaluationType 없이
 *   단순 `grade` 필드 하나만 가지고 있었다고 가정한다(석차등급만 존재, 성취평가 개념 없음).
 *   v1.0으로 올라오면서 evaluationType 필드가 추가되고, grade -> rankGrade로 이름이 바뀐다.
 *   이 마이그레이션은 실제로 동작하며 tests/migrations.test.ts 에서 검증한다.
 */

import { CURRENT_SCHEMA_VERSION, CURRENT_CURRICULUM_VERSION } from "../models/academic";
import { getCohortPolicy } from "../models/cohortPolicy";

export type MigrationFn = (data: any) => any;

/** key: fromVersion, value: { toVersion, migrate } */
export const MIGRATIONS: Record<string, { toVersion: string; migrate: MigrationFn }> = {
  "0.9": {
    toVersion: "1.0",
    migrate: (data: any) => {
      const next = deepClone(data);
      next.schemaVersion = "1.0";
      const now = new Date().toISOString();
      next.metadata = next.metadata ?? { createdAt: now, updatedAt: now };

      // legacy 파일의 등급체계/교육과정은 현재 프로그램의 폴백값으로 일괄 덮어쓰지 않는다.
      // 각 레코드의 실제 학년도+학년에서 입학연도를 역산해 코호트 정책을 적용한다.
      next.academicRecords = (next.academicRecords ?? []).map((r: any) => {
        const rec = { ...r };
        const hasCohortCoordinates =
          Number.isFinite(rec.academicYear) &&
          (rec.gradeLevel === 1 || rec.gradeLevel === 2 || rec.gradeLevel === 3);
        const policy = hasCohortCoordinates
          ? getCohortPolicy(rec.academicYear, rec.gradeLevel)
          : null;

        if (rec.evaluationType == null) {
          // v0.9에는 grade(석차등급)만 존재했다고 가정 -> rankGrade로 승격
          rec.evaluationType = "rankGrade";
          if (rec.grade != null) {
            rec.rankGrade = rec.grade;
            delete rec.grade;
          }
        }

        if (rec.evaluationType === "rankGrade" && rec.gradeScale == null) {
          rec.gradeScale = policy?.gradeScale;
        }
        return rec;
      });

      if (next.curriculumVersion == null) {
        const firstCohortRecord = next.academicRecords.find(
          (rec: any) =>
            Number.isFinite(rec.academicYear) &&
            (rec.gradeLevel === 1 || rec.gradeLevel === 2 || rec.gradeLevel === 3)
        );
        next.curriculumVersion = firstCohortRecord
          ? getCohortPolicy(firstCohortRecord.academicYear, firstCohortRecord.gradeLevel).curriculumVersion
          : CURRENT_CURRICULUM_VERSION;
      }
      next.mockExams = next.mockExams ?? [];
      next.targets = next.targets ?? [];
      next.applications = next.applications ?? [];
      next.profile = next.profile ?? {};
      return next;
    },
  },
  // 향후 예: "1.0": { toVersion: "1.1", migrate: (data) => { ... } },
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export interface MigrationOutcome {
  data: any;
  appliedMigrations: string[]; // 예: ["0.9->1.0"]
  originalVersion: string;
  finalVersion: string;
}

/**
 * 데이터를 현재 스키마 버전까지 순차 마이그레이션한다.
 * 원본 객체는 변경하지 않는다(깊은 복사 사용).
 */
export function migrateToCurrent(rawData: any): MigrationOutcome {
  let data = deepClone(rawData);
  const originalVersion = data.schemaVersion ?? "0.9";
  data.schemaVersion = originalVersion;

  const applied: string[] = [];
  let guard = 0;
  while (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    const fromVersion = data.schemaVersion;
    const step = MIGRATIONS[fromVersion];
    if (!step) {
      throw new Error(
        `스키마 버전 ${fromVersion}에서 ${CURRENT_SCHEMA_VERSION}(으)로 가는 마이그레이션 경로가 없습니다.`
      );
    }
    data = step.migrate(data);
    data.schemaVersion = step.toVersion;
    applied.push(`${fromVersion}->${step.toVersion}`);

    guard += 1;
    if (guard > 20) throw new Error("마이그레이션 루프가 비정상적으로 반복되고 있습니다.");
  }

  return {
    data,
    appliedMigrations: applied,
    originalVersion,
    finalVersion: data.schemaVersion,
  };
}
