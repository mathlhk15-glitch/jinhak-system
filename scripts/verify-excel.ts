import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildExcelWorkbook } from "../src/export/excelExporter";
import { createEmptyDataFile, generateId } from "../src/models/academic";
import type { StudentDataFile } from "../src/models/academic";

// 검수 지적: 이전에는 Claude 컨테이너 경로가 하드코딩되어 있어 다른 PC에서 실행하면
// 실패했다. 이 스크립트 파일 위치를 기준으로 한 상대경로만 사용한다.
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "verify-output.xlsx");

const data: StudentDataFile = createEmptyDataFile();
data.profile = { name: "홍길동", gradeLevel: 3 };
data.academicRecords = [
  { id: generateId(), academicYear: 2026, gradeLevel: 3, semester: 1, subjectGroup: "국어", courseName: "국어 항목1", credits: 4, evaluationType: "rankGrade", gradeScale: 5, rankGrade: 1 },
  { id: generateId(), academicYear: 2026, gradeLevel: 3, semester: 1, subjectGroup: "수학", courseName: "수학 항목1", credits: 4, evaluationType: "rankGrade", gradeScale: 5, rankGrade: 2 },
  { id: generateId(), academicYear: 2026, gradeLevel: 3, semester: 1, subjectGroup: "영어", courseName: "영어 항목1", credits: 3, evaluationType: "rankGrade", gradeScale: 5, rankGrade: 2 },
  { id: generateId(), academicYear: 2026, gradeLevel: 3, semester: 1, subjectGroup: "사회", courseName: "진로선택 사회", credits: 3, evaluationType: "achievement", achievement: "A" },
];
data.applications = [
  {
    id: generateId(),
    universityName: "경북대",
    majorName: "섬유시스템공학과",
    admissionType: "교과",
    reflectionRatio: "학생부80%+서류20%",
    reflectionSubjects: "국수영사과한",
    myConvertedGrade: 2.14,
    yearlyData: [
      { year: 2024, recruitCount: 5, competitionRate: 18.4, cut70: 3.09, finalCut: 3.4 },
      { year: 2025, recruitCount: 8, competitionRate: 18.38, cut70: 3.81, finalCut: 3.5 },
    ],
    memo: "1차 상담 대상",
  },
];
data.mockExams = [{ id: generateId(), academicYear: 2026, examLabel: "9월", korean: { grade: 2 }, math: { grade: 3 } }];
data.notes = "전체 상담 메모 테스트";

const wb = await buildExcelWorkbook(data);
console.log(
  "생성된 시트:",
  wb.worksheets.map((w) => w.name)
);
const buf = await wb.xlsx.writeBuffer();
writeFileSync(OUTPUT_PATH, Buffer.from(buf));
console.log("xlsx 파일 크기:", buf.byteLength, "bytes");
console.log("검증용 파일 저장 완료:", OUTPUT_PATH);
