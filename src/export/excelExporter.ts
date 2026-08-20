/**
 * 상담용 Excel(.xlsx) 생성기.
 * MVP 시트 구성: 01_상담요약 / 02_성적원자료 / 03_성적분석 / 04_대학조사 / 05_상담메모
 * (필요 없는 빈 시트는 만들지 않는다 — 예: applications가 비어 있어도 시트 자체는 생성하되
 *  안내 문구만 넣어 사용자가 당황하지 않게 한다.)
 *
 * 주의: 조합 정의(국수영사과 등)는 이 파일에 따로 두지 않고 models/subjectCombinations.ts
 * 를 UI와 공유한다 (검수 지적: 중복 정의 시 웹/Excel 결과가 어긋날 수 있음).
 * "전교과"는 고정 교과군 목록으로 필터링하지 않고 computeWeightedAverage(전체 레코드)를
 * 그대로 사용한다 (향후 새 교과군이 추가돼도 누락되지 않도록).
 */

import type ExcelJS from "exceljs";
import type { StudentDataFile } from "../models/academic";
import { REFERENCE_COMBINATIONS } from "../models/subjectCombinations";
import { computeSemesterCombinationMatrix, getSemesterAwareRecords } from "../engines/semesterAnalysis";
import { computeBySubjectGroup, computeCombination, computeWeightedAverage, getActiveGradeScale, isEmpty } from "../engines/gradeEngine";
import type { ComputedValue } from "../engines/gradeEngine";
import { convertFiveGradeAverageToNine, convertWeightedAverageToNine } from "../engines/gradeConversion";
import { prepareForExport } from "../storage/jsonBackup";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F3B57" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB9C2CC" } },
  left: { style: "thin", color: { argb: "FFB9C2CC" } },
  bottom: { style: "thin", color: { argb: "FFB9C2CC" } },
  right: { style: "thin", color: { argb: "FFB9C2CC" } },
};

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
}

function styleDataRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: "middle" };
  });
}

/** 가중평균 값을 셀에 "숫자"로 기록하고 표시형식만 소수 둘째자리로 지정한다.
 *  (검수 지적: 이전에는 formatGrade()가 만든 문자열을 그대로 넣어 Excel에서
 *  정렬·후속 계산이 불편했다.) 값이 없으면 텍스트 "-"를 넣는다. */
function writeGradeCell(cell: ExcelJS.Cell, cv: ComputedValue): void {
  if (isEmpty(cv)) {
    cell.value = "-";
  } else {
    cell.value = Math.round(cv.value * 100) / 100;
    cell.numFmt = "0.00";
  }
}

export async function buildExcelWorkbook(rawData: StudentDataFile): Promise<ExcelJS.Workbook> {
  // 익명 저장이 켜져 있으면 Excel 내용에서도 실제로 이름·학번을 제거한다.
  const data = prepareForExport(rawData);

  // ExcelJS는 번들이 크므로(약 900KB) "Excel 생성" 버튼을 누를 때만 동적으로 불러온다.
  const { default: ExcelJSModule } = await import("exceljs");
  const wb = new ExcelJSModule.Workbook();
  wb.creator = "창원경일고 진학설계 시스템";
  wb.created = new Date();

  const overall = computeBySubjectGroup(data.academicRecords);
  // 검수 지적: 첫 번째로 발견된 record의 gradeScale을 그대로 쓰면, 데이터가 실제로
  // 혼재되어 있을 때 "5등급제 기준"처럼 부정확하게 표시될 수 있었다. 평균 계산과
  // 완전히 동일한 기준(getActiveGradeScale)으로 판단한다.
  const activeGradeScale = getActiveGradeScale(data.academicRecords);

  const combos = REFERENCE_COMBINATIONS.map((def) => ({
    def,
    result: computeCombination(data.academicRecords, def.subjectGroups),
  }));
  const comboAll = computeWeightedAverage(data.academicRecords); // 전교과 = 전체 원자료 그대로

  // ── 01_상담요약 ─────────────────────────────────────────
  {
    const ws = wb.addWorksheet("01_상담요약", { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 42 }];

    ws.mergeCells("A1:D1");
    const title = ws.getCell("A1");
    title.value = "창원경일고 진학설계 — 상담 요약";
    title.font = { size: 16, bold: true, color: { argb: "FF1F3B57" } };
    ws.getRow(1).height = 28;

    ws.getCell("A3").value = "학생";
    ws.getCell("B3").value = data.profile.anonymized ? "익명" : data.profile.name || "-";
    ws.getCell("A4").value = "학년";
    ws.getCell("B4").value = data.profile.gradeLevel ?? "-";
    ws.getCell("A5").value = "생성일";
    ws.getCell("B5").value = new Date().toLocaleString("ko-KR");

    const summaryHeaderRow = ws.getRow(7);
    summaryHeaderRow.values = ["지표", "원등급", "9등급 환산", "비고"];
    styleHeaderRow(summaryHeaderRow);

    let r = 8;
    {
      const row = ws.getRow(r);
      row.getCell(1).value = "석차등급 산출과목 전교과 가중평균";
      writeGradeCell(row.getCell(2), comboAll.average);
      writeGradeCell(row.getCell(3), convertWeightedAverageToNine(comboAll));
      row.getCell(4).value = `${comboAll.courseCount}과목 / ${comboAll.totalCredits}단위`;
      styleDataRow(row);
      r += 1;
    }
    for (const c of combos) {
      const row = ws.getRow(r);
      row.getCell(1).value = `${c.def.label} 가중평균 (참고용 조합)`;
      writeGradeCell(row.getCell(2), c.result.average);
      writeGradeCell(row.getCell(3), convertWeightedAverageToNine(c.result));
      row.getCell(4).value = `${c.result.courseCount}과목 / ${c.result.totalCredits}단위`;
      styleDataRow(row);
      r += 1;
    }

    r += 1;
    ws.getCell(`A${r}`).value = "교과군별 가중평균";
    ws.getCell(`A${r}`).font = { bold: true };
    r += 1;
    const groupHeaderRow = ws.getRow(r);
    groupHeaderRow.values = ["교과군", "가중평균(원등급)", "9등급 환산", "단위수/과목수"];
    styleHeaderRow(groupHeaderRow);
    r += 1;
    for (const g of overall) {
      const row = ws.getRow(r);
      row.getCell(1).value = g.subjectGroup;
      writeGradeCell(row.getCell(2), g.result.average);
      writeGradeCell(row.getCell(3), convertWeightedAverageToNine(g.result));
      row.getCell(4).value = `${g.result.totalCredits}단위 / ${g.result.courseCount}과목`;
      styleDataRow(row);
      r += 1;
    }

    if (data.mockExams.length > 0) {
      r += 1;
      ws.getCell(`A${r}`).value = "모의고사 기록";
      ws.getCell(`A${r}`).font = { bold: true };
      r += 1;
      const mockHeaderRow = ws.getRow(r);
      mockHeaderRow.values = [
        "회차",
        "국어 등급",
        "국어 백분위",
        "수학 등급",
        "수학 백분위",
        "영어",
        "탐구1 등급",
        "탐구1 백분위",
        "탐구2 등급",
        "탐구2 백분위",
        "한국사",
        "국+수+탐구1 백분위합",
      ];
      styleHeaderRow(mockHeaderRow);
      r += 1;
      for (const m of data.mockExams) {
        const row = ws.getRow(r);
        const pctSum =
          m.korean?.percentile != null && m.math?.percentile != null && m.inquiry1?.percentile != null
            ? m.korean.percentile + m.math.percentile + m.inquiry1.percentile
            : "-";
        row.values = [
          m.examLabel,
          m.korean?.grade ?? "-",
          m.korean?.percentile ?? "-",
          m.math?.grade ?? "-",
          m.math?.percentile ?? "-",
          m.english?.grade ?? "-",
          m.inquiry1?.grade ?? "-",
          m.inquiry1?.percentile ?? "-",
          m.inquiry2?.grade ?? "-",
          m.inquiry2?.percentile ?? "-",
          m.koreanHistory?.grade ?? "-",
          pctSum,
        ];
        styleDataRow(row);
        r += 1;
      }
    }

    if (data.applications.length > 0) {
      r += 1;
      ws.getCell(`A${r}`).value = "수시 지원 후보 (04_대학조사 참조)";
      ws.getCell(`A${r}`).font = { bold: true };
      r += 1;
      for (const app of data.applications) {
        const row = ws.getRow(r);
        row.values = [`${app.universityName} / ${app.majorName}`, app.admissionType, app.myConvertedGrade ?? ""];
        styleDataRow(row);
        r += 1;
      }
    }

    if (comboAll.mixedGradeScaleWarning) {
      r += 1;
      ws.getCell(`A${r}`).value = "⚠ 서로 다른 등급체계(5등급제/9등급제)의 과목이 섞여 있어 가중평균을 계산하지 않았습니다. 02_성적원자료에서 확인하세요.";
      ws.getCell(`A${r}`).font = { color: { argb: "FFA23B2E" }, italic: true, size: 9 };
    }
  }

  // ── 02_성적원자료 ───────────────────────────────────────
  {
    const ws = wb.addWorksheet("02_성적원자료");
    ws.columns = [
      { header: "자료구분", key: "sourceMode", width: 14 },
      { header: "학년", key: "gradeLevel", width: 8 },
      { header: "학기", key: "semester", width: 8 },
      { header: "교과군", key: "subjectGroup", width: 12 },
      { header: "과목명", key: "courseName", width: 20 },
      { header: "단위수", key: "credits", width: 10 },
      { header: "평가유형", key: "evaluationType", width: 12 },
      { header: "석차등급", key: "rankGrade", width: 10 },
      { header: "등급체계", key: "gradeScale", width: 10 },
      { header: "9등급 환산(참고)", key: "convertedNine", width: 16 },
      { header: "성취도", key: "achievement", width: 10 },
      { header: "비고", key: "memo", width: 24 },
    ];
    styleHeaderRow(ws.getRow(1));
    const typeLabel: Record<string, string> = {
      rankGrade: "석차등급",
      achievement: "성취평가",
      passFail: "P/F",
      other: "기타",
    };
    // 검수 지적: 빠른입력으로 집계된 자료가 "실제 3학년 1학기 과목"처럼 오인될 수 있어,
    // 상담교사가 Excel만 보고도 자료 출처를 구분할 수 있도록 명시적인 열을 둔다.
    const sourceModeLabel: Record<string, string> = {
      quickAggregate: "빠른입력 누적",
      quickSemester: "학기지정 입력",
      precise: "정밀입력/자동추출",
    };
    for (const rec of data.academicRecords) {
      const row = ws.addRow({
        sourceMode: sourceModeLabel[rec.sourceMode ?? "quickAggregate"] ?? "빠른입력 누적",
        gradeLevel: rec.gradeLevel,
        semester: rec.semester,
        subjectGroup: rec.subjectGroup,
        courseName: rec.courseName,
        credits: rec.credits,
        evaluationType: typeLabel[rec.evaluationType] ?? rec.evaluationType,
        rankGrade: rec.rankGrade ?? "",
        gradeScale: rec.gradeScale ? `${rec.gradeScale}등급제` : "",
        convertedNine:
          rec.evaluationType === "rankGrade" && rec.rankGrade != null && rec.gradeScale === 5
            ? convertFiveGradeAverageToNine(rec.rankGrade) ?? ""
            : rec.evaluationType === "rankGrade" && rec.rankGrade != null && rec.gradeScale === 9
              ? rec.rankGrade
              : "",
        achievement: rec.achievement ?? "",
        memo: rec.memo ?? "",
      });
      styleDataRow(row);
    }
    if (data.academicRecords.length === 0) {
      ws.getCell("A2").value = "입력된 성적 원자료가 없습니다.";
    }
  }

  // ── 03_성적분석 ─────────────────────────────────────────
  {
    const ws = wb.addWorksheet("03_성적분석");
    ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 42 }];
    const headerRow = ws.getRow(1);
    headerRow.values = ["구분", "가중평균(원등급)", "9등급 환산", "산출근거"];
    styleHeaderRow(headerRow);

    let r = 2;
    for (const g of overall) {
      const row = ws.getRow(r);
      row.getCell(1).value = `${g.subjectGroup} (석차등급 산출과목)`;
      writeGradeCell(row.getCell(2), g.result.average);
      writeGradeCell(row.getCell(3), convertWeightedAverageToNine(g.result));
      row.getCell(4).value = `Σ(단위수×등급)÷Σ단위수, ${g.result.courseCount}과목/${g.result.totalCredits}단위`;
      styleDataRow(row);
      r += 1;
      if (g.result.excludedAchievementCourses.length > 0) {
        const names = g.result.excludedAchievementCourses
          .map((c) => `${c.courseName}(${c.achievement}/${c.credits}단위)`)
          .join(", ");
        const noteRow = ws.getRow(r);
        noteRow.getCell(1).value = "  └ 성취평가 과목(평균 제외)";
        noteRow.getCell(4).value = names;
        styleDataRow(noteRow);
        r += 1;
      }
    }

    r += 1;
    const comboHeaderRow = ws.getRow(r);
    comboHeaderRow.values = ["참고용 교과 조합", "가중평균(원등급)", "9등급 환산", "산출근거"];
    styleHeaderRow(comboHeaderRow);
    r += 1;
    for (const c of combos) {
      const row = ws.getRow(r);
      row.getCell(1).value = c.def.label;
      writeGradeCell(row.getCell(2), c.result.average);
      writeGradeCell(row.getCell(3), convertWeightedAverageToNine(c.result));
      row.getCell(4).value = `${c.result.courseCount}과목/${c.result.totalCredits}단위`;
      styleDataRow(row);
      r += 1;
    }
    {
      const row = ws.getRow(r);
      row.getCell(1).value = "전교과(석차등급 산출과목)";
      writeGradeCell(row.getCell(2), comboAll.average);
      writeGradeCell(row.getCell(3), convertWeightedAverageToNine(comboAll));
      row.getCell(4).value = `${comboAll.courseCount}과목/${comboAll.totalCredits}단위`;
      styleDataRow(row);
      r += 1;
    }

    const semesterAware = getSemesterAwareRecords(data.academicRecords);
    if (semesterAware.length > 0) {
      r += 2;
      ws.getCell(`A${r}`).value = "학기별 교과 조합 가중평균";
      ws.getCell(`A${r}`).font = { bold: true, size: 12 };
      r += 1;
      const semesterHeader = ws.getRow(r);
      const semesterHeaders: string[] = ["학기"];
      for (const combo of REFERENCE_COMBINATIONS) {
        semesterHeaders.push(`${combo.label}(원)`, `${combo.label}(9환산)`);
      }
      semesterHeaders.push("전교과(원)", "전교과(9환산)");
      semesterHeader.values = semesterHeaders;
      styleHeaderRow(semesterHeader);
      r += 1;
      const matrix = computeSemesterCombinationMatrix(data.academicRecords, REFERENCE_COMBINATIONS);
      for (const item of matrix) {
        const row = ws.getRow(r);
        row.getCell(1).value = item.label;
        let col = 2;
        for (const combo of REFERENCE_COMBINATIONS) {
          const result = item.combinations[combo.id];
          writeGradeCell(row.getCell(col), result.average);
          writeGradeCell(row.getCell(col + 1), convertWeightedAverageToNine(result));
          col += 2;
        }
        writeGradeCell(row.getCell(col), item.allSubjects.average);
        writeGradeCell(row.getCell(col + 1), convertWeightedAverageToNine(item.allSubjects));
        styleDataRow(row);
        if (item.semester == null) row.font = { bold: true };
        r += 1;
      }
      ws.getCell(`A${r}`).value = "※ 전체는 학기 평균의 단순평균이 아니라, 5개 학기 전체 과목을 합쳐 단위수 가중평균으로 다시 계산한 값입니다.";
      ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: "FF666666" } };
      r += 1;
    }

    r += 1;
    ws.getCell(`A${r}`).value =
      `등급체계: ${activeGradeScale != null ? `${activeGradeScale}등급제 기준` : "혼재 또는 판정 불가"}. 성취평가 과목은 위 모든 가중평균 계산에서 제외되었습니다. ` +
      `5등급제의 9등급 환산값은 제공된 Excel의 근사 VLOOKUP 환산표를 그대로 적용한 상담용 참고값이며 대학별 공식 환산식이 아닙니다. ` +
      `"참고용 교과 조합"은 아직 특정 대학의 확정된 반영규칙이 아닙니다.`;
    ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: "FF666666" } };
  }

  // ── 04_대학조사 ─────────────────────────────────────────
  {
    const ws = wb.addWorksheet("04_대학조사");
    ws.columns = [
      { header: "대학", key: "univ", width: 16 },
      { header: "학과", key: "major", width: 20 },
      { header: "전형", key: "admType", width: 12 },
      { header: "반영비율", key: "ratio", width: 18 },
      { header: "반영교과", key: "subjects", width: 16 },
      { header: "학년별 비율", key: "gradeWeight", width: 14 },
      { header: "수능최저(공통)", key: "csat", width: 16 },
      { header: "본인 환산성적", key: "myGrade", width: 12 },
      { header: "연도", key: "year", width: 8 },
      { header: "모집인원", key: "recruit", width: 10 },
      { header: "경쟁률", key: "competition", width: 10 },
      { header: "충원", key: "additional", width: 10 },
      { header: "70%컷", key: "cut70", width: 10 },
      { header: "최종", key: "final", width: 10 },
      { header: "연도별 수능최저", key: "yearCsat", width: 16 },
    ];
    styleHeaderRow(ws.getRow(1));

    if (data.applications.length === 0) {
      ws.getCell("A2").value = "조사한 대학이 없습니다. 학생이 직접 조사한 3개년 입결 자료를 입력하면 이 시트에 반영됩니다.";
    }
    for (const app of data.applications) {
      const yearlyRows = app.yearlyData && app.yearlyData.length > 0 ? app.yearlyData : [undefined];
      for (const y of yearlyRows) {
        const row = ws.addRow({
          univ: app.universityName,
          major: app.majorName,
          admType: app.admissionType,
          ratio: app.reflectionRatio ?? "",
          subjects: app.reflectionSubjects ?? "",
          gradeWeight: app.gradeWeightNote ?? "",
          csat: app.csatMinimum ?? "",
          myGrade: app.myConvertedGrade ?? "",
          year: y?.year ?? "",
          recruit: y?.recruitCount ?? "",
          competition: y?.competitionRate ?? "",
          additional: y?.additionalAdmit ?? "",
          cut70: y?.cut70 ?? "",
          final: y?.finalCut ?? "",
          yearCsat: y?.csatMinimum ?? "",
        });
        styleDataRow(row);
      }
    }
  }

  // ── 05_상담메모 ─────────────────────────────────────────
  {
    const ws = wb.addWorksheet("05_상담메모");
    ws.columns = [{ width: 100 }];
    ws.getCell("A1").value = "상담 메모";
    ws.getCell("A1").font = { bold: true, size: 13 };
    let r = 3;

    if (data.notes && data.notes.trim()) {
      ws.getCell(`A${r}`).value = "전체 상담메모";
      ws.getCell(`A${r}`).font = { bold: true };
      r += 1;
      ws.getCell(`A${r}`).value = data.notes;
      ws.getCell(`A${r}`).alignment = { wrapText: true };
      r += 2;
    }

    const appMemos = data.applications.filter((a) => a.memo && a.memo.trim());
    if (appMemos.length > 0) {
      ws.getCell(`A${r}`).value = "대학별 상담메모";
      ws.getCell(`A${r}`).font = { bold: true };
      r += 1;
      for (const app of appMemos) {
        ws.getCell(`A${r}`).value = `[${app.universityName} ${app.majorName}] ${app.memo}`;
        ws.getCell(`A${r}`).alignment = { wrapText: true };
        r += 1;
      }
    }

    if (!(data.notes && data.notes.trim()) && appMemos.length === 0) {
      ws.getCell(`A${r}`).value = "(아직 작성된 상담 메모가 없습니다.)";
      ws.getCell(`A${r}`).font = { italic: true, color: { argb: "FF999999" } };
    }
  }

  return wb;
}

export async function exportToExcelFile(rawData: StudentDataFile, filename?: string): Promise<void> {
  const data = prepareForExport(rawData);
  const wb = await buildExcelWorkbook(rawData);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const namePart = data.profile.anonymized ? "익명" : data.profile.name || "학생";
  a.href = url;
  a.download = filename ?? `${namePart}_상담자료.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
