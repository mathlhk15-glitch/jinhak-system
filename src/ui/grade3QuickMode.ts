/**
 * 1·2·3학년 통합 상담 UI (기존 파일명은 하위호환을 위해 유지).
 *
 * - 계산 로직은 절대 이 파일에 두지 않는다 (engines/*.ts 호출만 한다).
 * - 입력 필드는 상태(state.academicRecords 등)를 직접 수정하고, 결과 패널만 다시 그린다
 *   (전체 재렌더링 시 타이핑 중 포커스가 끊기는 문제를 피하기 위함).
 * - mountApp()은 "현재 state를 화면에 그리는" 순수 함수다. 자동저장 복구는
 *   bootstrapApp()에서 시작 시 딱 한 번만 수행한다 (mountApp 안에서 다시 호출하면
 *   무한 재귀가 발생하므로 절대 섞지 않는다 — 검수에서 지적된 P0 버그).
 */

import {
  createEmptyDataFile,
  generateId,
  SUBJECT_GROUPS,
  type StudentDataFile,
  type AcademicRecord,
  type ApplicationRecord,
  type MockExamRecord,
  type GradeScale,
  type AchievementLevel,
} from "../models/academic";
import { REFERENCE_COMBINATIONS } from "../models/subjectCombinations";
import { COUNSELING_SEMESTERS, computeSemesterCombinationMatrix, getSemesterAwareRecords } from "../engines/semesterAnalysis";
import { importTranscriptDocument, type ImportProgress } from "../importers/documentImporter";
import type { ParsedTranscriptRecord } from "../importers/transcriptParser";
import { getCohortPolicy } from "../models/cohortPolicy";
import { getCurrentAcademicYear } from "../utils/academicYear";
import {
  computeBySubjectGroup,
  computeCombination,
  computeWeightedAverage,
  formatGrade,
  getActiveGradeScale,
} from "../engines/gradeEngine";
import { computeReverseTarget, computeScenarios } from "../engines/targetEngine";
import { convertFiveGradeAverageToNine, convertGradeAverageToNine, convertWeightedAverageToNine } from "../engines/gradeConversion";
import { splitRecordsBySourceMode } from "../engines/recordReconciliation";
import { autosave, loadAutosave, clearAutosave } from "../storage/indexedDb";
import { downloadJsonFile, parseAndMigrate, readFileAsText } from "../storage/jsonBackup";
import { exportToExcelFile } from "../export/excelExporter";
import {
  validateCredits,
  validateRankGrade,
  validateTargetGrade,
  validateMockExamGrade,
  validatePercentile,
  validateYear,
  validateNonNegativeInteger,
  validateNonNegativeNumber,
} from "../utils/validation";
import { el, clear } from "../utils/dom";

interface QuickEntry {
  entryId: string;
  gradeLevel?: 1 | 2 | 3;
  semester?: 1 | 2;
  periodSpecified?: boolean;
  courseName?: string;
  evaluationType: "rankGrade" | "achievement";
  credits?: number;
  rankGrade?: number;
  achievement?: AchievementLevel;
  /** 이 항목 고유의 등급체계. 없으면 전역 select 기본값을 사용한다.
   *  (검수 지적 반영: 전역 gradeScale 하나로 모든 항목을 덮어쓰면 가져온 데이터의
   *  원래 등급체계가 소실될 수 있어, 항목별로 보존한다.) */
  gradeScale?: GradeScale;
}

let state: StudentDataFile = createEmptyDataFile();
let currentRoot: HTMLElement | null = null;
let importCandidates: ParsedTranscriptRecord[] = [];
let importWarnings: string[] = [];
let importProgressText = "";
let pasteHandlerInstalled = false;
let importQueue: Promise<void> = Promise.resolve();

function getStudentCurrentGrade(): 1 | 2 | 3 {
  return state.profile.gradeLevel ?? 3;
}

/** 현재 학년을 기준으로 과거 학년의 실제 학년도를 역산한다. */
function academicYearForGradeLevel(gradeLevel: 1 | 2 | 3): number {
  return getCurrentAcademicYear() - (getStudentCurrentGrade() - gradeLevel);
}
/**
 * 새로 추가하는 항목의 기본 등급체계로만 쓰인다. 기존 항목을 소급 변경하지 않는다.
 * 현재 학년과 학년도를 기준으로 getCohortPolicy()가 입학연도를 역산해 5등급/9등급을 판정한다.
 * 사용자가 현재 학년을 바꾸면 새 과목 기본 등급체계와 curriculumVersion도 함께 갱신한다.
 */
let gradeScale: GradeScale = getCohortPolicy(getCurrentAcademicYear(), getStudentCurrentGrade()).gradeScale;
let quickEntries: Record<string, QuickEntry[]> = Object.fromEntries(SUBJECT_GROUPS.map((s) => [s, []]));
/** 빠른모드 UI가 편집할 수 없는 레코드(P/F, 기타 유형 등)를 그대로 보존한다.
 *  (검수 지적: 편집 불가 유형을 rankGrade로 몰래 바꾸면 원자료가 손실된다.) */
let preservedRecords: AcademicRecord[] = [];

let saveTimer: number | undefined;
let toastEl: HTMLDivElement;

/** 앱 시작 시 단 한 번만 호출한다. 자동저장 복구는 여기서만 수행하고,
 *  mountApp()은 이후 순수 렌더링 함수로만 사용한다. */
export async function bootstrapApp(root: HTMLElement): Promise<void> {
  currentRoot = root;
  installGlobalPasteHandler();
  let restored = false;
  const saved = await loadAutosave();
  if (saved) {
    try {
      const { data } = parseAndMigrate(JSON.stringify(saved));
      state = data;
      rebuildQuickEntriesFromState();
      restored = true;
    } catch (e) {
      console.warn("자동저장 데이터 복구 실패:", e);
    }
  }
  mountApp(root);
  if (restored) showToast("이전에 자동저장된 데이터를 불러왔습니다.");
}

/** 현재 state를 화면에 그린다. 절대로 autosave를 다시 읽지 않는다(재귀 방지). */
export function mountApp(root: HTMLElement): void {
  currentRoot = root;
  clear(root);

  const app = el("div", { class: "app-shell" });
  root.appendChild(app);

  app.appendChild(renderMasthead());
  app.appendChild(renderProfileBar());
  app.appendChild(renderImportSection());
  app.appendChild(renderGradeSection());
  app.appendChild(renderTargetSection());
  app.appendChild(renderMockExamSection());
  app.appendChild(renderUniversitySection());
  app.appendChild(renderMemoSection());
  app.appendChild(renderActionBar());

  toastEl = el("div", { class: "toast" }) as HTMLDivElement;
  root.appendChild(toastEl);

  root.appendChild(
    el("p", { class: "footer-note" }, [
      "창원경일고 학생부 성적분석 시스템 · 성적 데이터는 서버로 전송되지 않고 이 기기와 내려받은 JSON 파일에만 저장됩니다.",
    ])
  );
}

function rebuildQuickEntriesFromState(): void {
  quickEntries = Object.fromEntries(SUBJECT_GROUPS.map((s) => [s, []]));

  // 1단계: 정밀입력(sourceMode: "precise")으로 만들어진 레코드는 절대 손대지 않고 보존한다.
  // (검수 지적 P0: 1·2학년 정밀 원자료가 3학년 빠른모드를 거치면서 "국어 항목1" 같은
  //  집계값으로 축소되어 courseId·실제 학년/학기·rawScore 등이 사라지던 문제)
  const { editable, preserved } = splitRecordsBySourceMode(state.academicRecords);
  preservedRecords = [...preserved];

  for (const rec of editable) {
    // 2단계: 편집 가능한 레코드 중에서도 빠른모드 UI가 표현할 수 없는 유형(P/F, 기타)은
    // 마찬가지로 편집 대상에서 제외하고 그대로 보존한다.
    if (rec.evaluationType === "passFail" || rec.evaluationType === "other") {
      preservedRecords.push(rec);
      continue;
    }
    const group = SUBJECT_GROUPS.includes(rec.subjectGroup as any) ? rec.subjectGroup : "기타";
    if (!quickEntries[group]) quickEntries[group] = [];
    quickEntries[group].push({
      entryId: rec.id,
      gradeLevel: rec.sourceMode === "quickSemester" ? rec.gradeLevel : undefined,
      semester: rec.sourceMode === "quickSemester" ? rec.semester : undefined,
      periodSpecified: rec.sourceMode === "quickSemester",
      courseName: rec.courseName,
      evaluationType: rec.evaluationType === "achievement" ? "achievement" : "rankGrade",
      credits: rec.credits,
      rankGrade: rec.rankGrade,
      achievement: rec.achievement,
      gradeScale: rec.gradeScale, // 항목별 원래 값 보존 (전역 변수로 뭉개지 않음)
    });
  }

  // 전역 select는 "새 항목 추가 시 기본값"으로만 쓰이므로, 가장 많이 쓰인 값으로 맞춰둔다.
  // (목표등급 계산 등 실제 데이터 기반 판단에는 이 값을 쓰지 않고 getActiveGradeScale을 쓴다.)
  const scaleCounts = new Map<number, number>();
  for (const list of Object.values(quickEntries)) {
    for (const e of list) {
      if (e.gradeScale) scaleCounts.set(e.gradeScale, (scaleCounts.get(e.gradeScale) ?? 0) + 1);
    }
  }
  if (scaleCounts.size > 0) {
    gradeScale = [...scaleCounts.entries()].sort((a, b) => b[1] - a[1])[0][0] as GradeScale;
  } else {
    gradeScale = getCohortPolicy(getCurrentAcademicYear(), getStudentCurrentGrade()).gradeScale;
  }
}

// ─────────────────────────────────────────────────────────
// 헤더
// ─────────────────────────────────────────────────────────

function renderMasthead(): HTMLElement {
  return el("header", { class: "masthead" }, [
    el("div", { class: "masthead-titles" }, [
      el("div", { class: "eyebrow" }, ["CHANGWON GYEONGIL H.S."]),
      el("h1", {}, ["학생부 성적분석 시스템"]),
      el("div", { class: "subtitle" }, ["1·2·3학년 학생부 성적 · 단위수 가중평균 · 5→9등급 참고환산"]),
      el("div", { class: "version-badge" }, ["v1.4.1 · 공식 학생부 표 정밀인식 · 5개 학기 검증"]),
    ]),
  ]);
}

// ─────────────────────────────────────────────────────────
// 학생부 PDF / 성적표 이미지 자동 불러오기
// ─────────────────────────────────────────────────────────

function enqueueTranscriptFiles(files: File[]): void {
  // 빠르게 연속 붙여넣기해도 이전 분석 결과를 덮어쓰지 않도록 순차 처리한다.
  importQueue = importQueue.then(() => processTranscriptFiles(files, true));
}

function installGlobalPasteHandler(): void {
  if (pasteHandlerInstalled) return;
  pasteHandlerInstalled = true;
  document.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);
    if (files.length === 0) return;
    event.preventDefault();
    enqueueTranscriptFiles(files);
  });
}

function importCandidateKey(r: ParsedTranscriptRecord): string {
  return [r.gradeLevel, r.semester, r.subjectGroup, r.courseName.replace(/\s+/g, ""), r.credits, r.rankGrade ?? r.achievement ?? ""].join("|");
}

/**
 * 여러 PDF/이미지를 순차 분석해 하나의 검토표에 누적한다.
 * append=true이면 Ctrl+V를 여러 번 해도 앞서 붙여넣은 사진의 후보를 보존한다.
 */
async function processTranscriptFiles(files: File[], append = true): Promise<void> {
  const accepted = files.filter((file) => file.type === "application/pdf" || file.type.startsWith("image/"));
  if (accepted.length === 0) {
    importWarnings = ["PDF 또는 이미지 파일만 불러올 수 있습니다."];
    if (currentRoot) mountApp(currentRoot);
    return;
  }

  const baseCandidates = append ? [...importCandidates] : [];
  const baseWarnings = append ? [...importWarnings] : [];
  const added: ParsedTranscriptRecord[] = [];
  const warnings: string[] = [];

  importProgressText = `${accepted.length}개 파일 분석을 시작합니다...`;
  if (currentRoot) mountApp(currentRoot);

  for (let index = 0; index < accepted.length; index += 1) {
    const file = accepted[index];
    try {
      const result = await importTranscriptDocument(file, (progress: ImportProgress) => {
        importProgressText = `[${index + 1}/${accepted.length}] ${file.name || "붙여넣은 이미지"} · ${progress.stage}${progress.percent != null ? ` · ${progress.percent}%` : ""}`;
        const progressEl = document.getElementById("import-progress");
        if (progressEl) progressEl.textContent = importProgressText;
      });
      added.push(...result.records);
      warnings.push(...result.warnings.map((warning) => `${file.name || `이미지 ${index + 1}`}: ${warning}`));
    } catch (e) {
      console.error(e);
      warnings.push(`${file.name || `파일 ${index + 1}`}: ${e instanceof Error ? e.message : "파일 분석 중 오류가 발생했습니다."}`);
    }
  }

  const seen = new Set(baseCandidates.map(importCandidateKey));
  const dedupedAdded: ParsedTranscriptRecord[] = [];
  for (const candidate of added) {
    const key = importCandidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedAdded.push(candidate);
  }
  importCandidates = [...baseCandidates, ...dedupedAdded];
  importWarnings = [...baseWarnings, ...warnings];
  importProgressText = `${accepted.length}개 파일 분석 완료 · 새 후보 ${dedupedAdded.length}건 · 검토표 누적 ${importCandidates.length}건`;
  if (currentRoot) mountApp(currentRoot);
}

function importedRecordsToAcademic(records: ParsedTranscriptRecord[]): AcademicRecord[] {
  const currentYear = getCurrentAcademicYear();
  return records.map((r) => {
    const academicYear = currentYear - (getStudentCurrentGrade() - r.gradeLevel);
    const policy = getCohortPolicy(academicYear, r.gradeLevel);
    return {
      id: generateId("import"),
      academicYear,
      gradeLevel: r.gradeLevel,
      semester: r.semester,
      subjectGroup: r.subjectGroup,
      courseName: r.courseName,
      credits: r.credits,
      evaluationType: r.evaluationType,
      gradeScale: r.evaluationType === "rankGrade" ? policy.gradeScale : undefined,
      rankGrade: r.evaluationType === "rankGrade" ? r.rankGrade : undefined,
      achievement: r.evaluationType === "achievement" ? r.achievement : undefined,
      memo: `자동추출 신뢰도 ${Math.round(r.confidence * 100)}%`,
      sourceMode: "precise",
    };
  });
}

function recordDuplicateKey(r: AcademicRecord): string {
  return [r.gradeLevel, r.semester, r.subjectGroup, r.courseName.replace(/\s+/g, ""), r.credits, r.rankGrade ?? r.achievement ?? ""].join("|");
}

function renderImportSection(): HTMLElement {
  const section = el("section", { class: "card import-card" });
  section.append(
    el("h2", {}, [
      el("span", { class: "section-number" }, ["00"]),
      "학생부·성적표 자동 불러오기 ",
      el("span", { class: "feature-badge" }, ["NEW"]),
    ]),
    el("p", { class: "card-desc" }, [
      "학생부 PDF 또는 성적표 이미지를 여러 개 선택하거나 아래 영역에 한꺼번에 끌어놓으세요. 캡처한 성적표 이미지는 Ctrl+V로 여러 번 붙여넣을 수 있고, 이전 후보가 사라지지 않고 누적됩니다. ",
      "PDF는 텍스트를 우선 읽고, 스캔 PDF·사진은 브라우저 OCR로 처리합니다. 파일 내용은 성적 추출을 위해 외부 서버로 업로드하지 않지만 OCR/PDF 라이브러리와 한글 인식모델은 CDN에서 내려받습니다. ",
      "자동 인식은 틀릴 수 있으므로 반드시 아래 검토표를 확인한 뒤 반영하세요.",
    ])
  );

  const fileInput = el("input", {
    type: "file",
    accept: "application/pdf,image/*",
    multiple: "multiple",
    style: "display:none",
  }) as HTMLInputElement;
  const choosePdf = el("button", { class: "btn secondary", type: "button" }, ["PDF·성적 사진 여러 장 선택"]);
  choosePdf.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    if (files.length > 0) enqueueTranscriptFiles(files);
    fileInput.value = "";
  });

  const dropZone = el("div", { class: "import-drop-zone", tabindex: "0" }, [
    el("div", { class: "drop-icon" }, ["PDF / IMG"]),
    el("strong", {}, ["학생부 PDF 또는 성적 사진 여러 장을 한꺼번에 드롭"]),
    el("span", {}, ["또는 캡처 이미지를 Ctrl+V로 여러 번 붙여넣기 · 후보가 누적됩니다"]),
  ]);
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) enqueueTranscriptFiles(files);
  });
  dropZone.addEventListener("click", () => fileInput.click());

  const clearCandidatesBtn = el("button", { class: "btn secondary", type: "button" }, ["검토 후보 비우기"]);
  clearCandidatesBtn.addEventListener("click", () => {
    importCandidates = [];
    importWarnings = [];
    importProgressText = "검토 후보를 비웠습니다.";
    if (currentRoot) mountApp(currentRoot);
  });
  const controls = el("div", { class: "import-controls" }, [choosePdf, clearCandidatesBtn, fileInput]);
  section.append(controls, dropZone);

  const progress = el("div", { id: "import-progress", class: "import-progress" }, [importProgressText]);
  section.appendChild(progress);

  if (importWarnings.length > 0) {
    const warningBox = el("div", { class: "import-warning" });
    for (const warning of importWarnings) warningBox.appendChild(el("div", {}, [`⚠ ${warning}`]));
    section.appendChild(warningBox);
  }

  if (importCandidates.length > 0) {
    const recognitionSummary = el("div", { class: "recognition-summary" });
    recognitionSummary.appendChild(el("strong", {}, ["자동인식 학기별 확인"]));
    for (const period of COUNSELING_SEMESTERS) {
      const periodRecords = importCandidates.filter(
        (candidate) => candidate.gradeLevel === period.gradeLevel && candidate.semester === period.semester
      );
      const rankCount = periodRecords.filter((candidate) => candidate.evaluationType === "rankGrade").length;
      const achievementCount = periodRecords.filter((candidate) => candidate.evaluationType === "achievement").length;
      recognitionSummary.appendChild(
        el("span", { class: rankCount > 0 ? "recognition-chip" : "recognition-chip missing" }, [
          `${period.label} · 등급 ${rankCount}건${achievementCount > 0 ? ` · 성취 ${achievementCount}건` : ""}`,
        ])
      );
    }
    section.appendChild(recognitionSummary);

    const tableWrap = el("div", { class: "table-scroll import-review" });
    const table = el("table", { class: "ledger" });
    table.appendChild(
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["학년"]),
          el("th", {}, ["학기"]),
          el("th", {}, ["교과군"]),
          el("th", {}, ["과목명"]),
          el("th", { class: "num" }, ["단위"]),
          el("th", {}, ["평가방식"]),
          el("th", { class: "num" }, ["등급/성취"]),
          el("th", { class: "num" }, ["9등급 환산"]),
          el("th", { class: "num" }, ["확신도"]),
          el("th", {}, ["삭제"]),
        ]),
      ])
    );
    const tbody = el("tbody", {});
    importCandidates.forEach((candidate, index) => {
      const gradeSelect = el("select", {}) as HTMLSelectElement;
      [1, 2, 3].forEach((g) => gradeSelect.appendChild(el("option", { value: String(g) }, [`${g}학년`]) as HTMLOptionElement));
      gradeSelect.value = String(candidate.gradeLevel);
      gradeSelect.addEventListener("change", () => {
        candidate.gradeLevel = Number(gradeSelect.value) as 1 | 2 | 3;
        updateCandidateConversion();
      });

      const semesterSelect = el("select", {}) as HTMLSelectElement;
      [1, 2].forEach((sem) => semesterSelect.appendChild(el("option", { value: String(sem) }, [`${sem}학기`]) as HTMLOptionElement));
      semesterSelect.value = String(candidate.semester);
      semesterSelect.addEventListener("change", () => (candidate.semester = Number(semesterSelect.value) as 1 | 2));

      const groupSelect = el("select", {}) as HTMLSelectElement;
      SUBJECT_GROUPS.forEach((g) => groupSelect.appendChild(el("option", { value: g }, [g]) as HTMLOptionElement));
      groupSelect.value = candidate.subjectGroup;
      groupSelect.addEventListener("change", () => (candidate.subjectGroup = groupSelect.value as any));

      const courseInput = el("input", { type: "text", value: candidate.courseName }) as HTMLInputElement;
      courseInput.addEventListener("input", () => (candidate.courseName = courseInput.value));
      const creditsInput = el("input", { type: "number", min: "1", max: "20", value: String(candidate.credits) }) as HTMLInputElement;
      creditsInput.addEventListener("input", () => (candidate.credits = creditsInput.valueAsNumber));

      const evalSelect = el("select", {}) as HTMLSelectElement;
      evalSelect.append(
        el("option", { value: "rankGrade" }, ["등급"]) as HTMLOptionElement,
        el("option", { value: "achievement" }, ["성취평가"]) as HTMLOptionElement
      );
      evalSelect.value = candidate.evaluationType;
      evalSelect.addEventListener("change", () => {
        candidate.evaluationType = evalSelect.value as "rankGrade" | "achievement";
        if (candidate.evaluationType === "rankGrade") candidate.achievement = undefined;
        else candidate.rankGrade = undefined;
        if (currentRoot) mountApp(currentRoot);
      });

      let scoreControl: HTMLElement;
      let rankGradeInput: HTMLInputElement | null = null;
      if (candidate.evaluationType === "rankGrade") {
        const initialAcademicYear = getCurrentAcademicYear() - (getStudentCurrentGrade() - candidate.gradeLevel);
        const initialScale = getCohortPolicy(initialAcademicYear, candidate.gradeLevel).gradeScale;
        const input = el("input", { type: "number", min: "1", max: String(initialScale), value: candidate.rankGrade != null ? String(candidate.rankGrade) : "" }) as HTMLInputElement;
        rankGradeInput = input;
        input.addEventListener("input", () => {
          candidate.rankGrade = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : undefined;
          updateCandidateConversion();
        });
        scoreControl = input;
      } else {
        const select = el("select", {}) as HTMLSelectElement;
        ["A", "B", "C", "D", "E"].forEach((a) => select.appendChild(el("option", { value: a }, [a]) as HTMLOptionElement));
        select.value = candidate.achievement ?? "A";
        select.addEventListener("change", () => (candidate.achievement = select.value as AchievementLevel));
        scoreControl = select;
      }

      const conversionDisplay = el("span", { class: "entry-conversion-hint" }, []);
      function updateCandidateConversion(): void {
        if (candidate.evaluationType !== "rankGrade" || candidate.rankGrade == null) {
          conversionDisplay.textContent = "-";
          return;
        }
        const academicYear = getCurrentAcademicYear() - (getStudentCurrentGrade() - candidate.gradeLevel);
        const candidateScale = getCohortPolicy(academicYear, candidate.gradeLevel).gradeScale;
        if (rankGradeInput) {
          rankGradeInput.max = String(candidateScale);
          const check = validateRankGrade(candidate.rankGrade, candidateScale);
          rankGradeInput.setCustomValidity(check.valid ? "" : check.message ?? "");
        }
        const converted = candidateScale === 9
          ? candidate.rankGrade
          : convertFiveGradeAverageToNine(candidate.rankGrade);
        conversionDisplay.textContent = converted == null ? "-" : converted.toFixed(2);
      }
      updateCandidateConversion();

      const remove = el("button", { class: "remove-btn", type: "button" }, ["✕"]);
      remove.addEventListener("click", () => {
        importCandidates.splice(index, 1);
        if (currentRoot) mountApp(currentRoot);
      });

      tbody.appendChild(
        el("tr", candidate.confidence < 0.7 ? { class: "review-low-confidence" } : {}, [
          el("td", {}, [gradeSelect]),
          el("td", {}, [semesterSelect]),
          el("td", {}, [groupSelect]),
          el("td", {}, [courseInput]),
          el("td", { class: "num" }, [creditsInput]),
          el("td", {}, [evalSelect]),
          el("td", { class: "num" }, [scoreControl]),
          el("td", { class: "num" }, [conversionDisplay]),
          el("td", { class: "num" }, [`${Math.round(candidate.confidence * 100)}%`]),
          el("td", {}, [remove]),
        ])
      );
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);

    const applyMode = el("select", {}) as HTMLSelectElement;
    applyMode.append(
      el("option", { value: "replace" }, ["기존 성적 전체를 이번 자동추출 결과로 대체(권장)"]) as HTMLOptionElement,
      el("option", { value: "append" }, ["기존 성적에 추가(중복은 제외)"]) as HTMLOptionElement
    );
    const applyBtn = el("button", { class: "btn primary", type: "button" }, ["검토한 성적 반영"]);
    applyBtn.addEventListener("click", () => {
      const imported = importedRecordsToAcademic(importCandidates).filter((r) => r.credits > 0 && (r.rankGrade != null || r.achievement != null));
      if (applyMode.value === "replace") {
        state.academicRecords = imported;
      } else {
        const existingKeys = new Set(state.academicRecords.map(recordDuplicateKey));
        state.academicRecords = [
          ...state.academicRecords,
          ...imported.filter((r) => !existingKeys.has(recordDuplicateKey(r))),
        ];
      }
      importCandidates = [];
      importWarnings = [];
      importProgressText = `${imported.length}건의 성적을 반영했습니다.`;
      rebuildQuickEntriesFromState();
      scheduleAutosave();
      if (currentRoot) mountApp(currentRoot);
    });
    section.appendChild(el("div", { class: "import-apply-row" }, [applyMode, applyBtn]));
  }

  return section;
}

// ─────────────────────────────────────────────────────────
// 학생 프로필 바
// ─────────────────────────────────────────────────────────

function renderProfileBar(): HTMLElement {
  const bar = el("div", { class: "profile-bar" });

  const nameLabel = el("label", {}, ["이름"]);
  const nameInput = el("input", { type: "text", value: state.profile.name ?? "", placeholder: "홍길동" }) as HTMLInputElement;
  nameInput.addEventListener("input", () => {
    state.profile.name = nameInput.value;
    scheduleAutosave();
  });
  nameLabel.appendChild(nameInput);

  const currentAcademicYear = getCurrentAcademicYear();
  const gradeLabel = el("label", {}, ["현재 학년"]);
  const gradeSelect = el("select", {}) as HTMLSelectElement;
  [1, 2, 3].forEach((g) => gradeSelect.appendChild(el("option", { value: String(g) }, [`${g}학년`]) as HTMLOptionElement));
  gradeSelect.value = String(getStudentCurrentGrade());
  gradeSelect.addEventListener("change", () => {
    const selected = Number(gradeSelect.value) as 1 | 2 | 3;
    state.profile.gradeLevel = selected;
    const selectedPolicy = getCohortPolicy(currentAcademicYear, selected);
    gradeScale = selectedPolicy.gradeScale;
    state.curriculumVersion = selectedPolicy.curriculumVersion;
    scheduleAutosave();
    if (currentRoot) mountApp(currentRoot);
  });
  gradeLabel.appendChild(gradeSelect);

  const anonLabel = el("label", {}, []);
  const anonCheckbox = el("input", { type: "checkbox" }) as HTMLInputElement;
  anonCheckbox.checked = !!state.profile.anonymized;
  anonCheckbox.addEventListener("change", () => {
    state.profile.anonymized = anonCheckbox.checked;
    scheduleAutosave();
  });
  anonLabel.append(anonCheckbox, " 익명 저장 (JSON·Excel 파일에서 이름·학번 제거)");

  const currentCohortPolicy = getCohortPolicy(currentAcademicYear, getStudentCurrentGrade());
  const scaleLabel = el("label", { title: `새로 추가하는 과목에만 적용되는 기본값입니다. 이미 입력된 성적이나 목표등급 계산은 각 과목에 실제 저장된 등급체계를 따릅니다. ${currentAcademicYear}학년도 ${getStudentCurrentGrade()}학년은 ${currentCohortPolicy.gradeScale}등급제 코호트로 자동 판정됩니다.` }, [
    "새 과목 입력 시 기본 등급체계",
  ]);
  const scaleSelect = el("select", {}) as HTMLSelectElement;
  scaleSelect.append(
    el("option", { value: "5" }, ["5등급제"]) as HTMLOptionElement,
    el("option", { value: "9" }, ["9등급제"]) as HTMLOptionElement
  );
  scaleSelect.value = String(gradeScale);
  scaleSelect.addEventListener("change", () => {
    gradeScale = Number(scaleSelect.value) as GradeScale;
    scheduleAutosave();
  });
  scaleLabel.appendChild(scaleSelect);

  const saveIndicator = el("div", { class: "save-indicator", id: "save-indicator" }, [
    el("span", { class: "dot" }, []),
    "자동저장 대기",
  ]);

  bar.append(nameLabel, gradeLabel, anonLabel, scaleLabel, saveIndicator);
  return bar;
}

// ─────────────────────────────────────────────────────────
// 성적 입력 (교과군별 단위수 + 등급)
// ─────────────────────────────────────────────────────────

let gradeSectionSummaryContainer: HTMLElement;

function renderGradeSection(): HTMLElement {
  const section = el("section", { class: "card" });
  section.append(
    el("h2", {}, [el("span", { class: "section-number" }, ["01"]), "성적 입력 (교과군별 단위수 · 등급)"]),
    el("p", { class: "card-desc" }, [
      "교과군마다 이수한 과목 수만큼 '입력 추가'를 눌러 단위수와 등급을 입력하세요. ",
      "등급이 산출되지 않는 성취평가(A~E) 과목은 유형을 '성취평가'로 바꾸면 평균 계산에서 자동으로 제외되고 별도로 표시됩니다. ",
      "각 입력행에서 이수 학기를 선택하면 학기별·전체 가중평균에 자동 반영됩니다. ",
      `${getCurrentAcademicYear()}학년도 ${getStudentCurrentGrade()}학년은 코호트 정책에 따라 ${getCohortPolicy(getCurrentAcademicYear(), getStudentCurrentGrade()).gradeScale}등급제가 기본값입니다. 5등급제 평균은 제공된 환산표 기준 9등급 참고값을 함께 표시합니다.`,
    ])
  );

  for (const subject of SUBJECT_GROUPS) {
    section.appendChild(renderSubjectBlock(subject));
  }

  gradeSectionSummaryContainer = el("div", { class: "summary-wrap table-scroll" });
  section.appendChild(gradeSectionSummaryContainer);
  renderGradeSummaryInto(gradeSectionSummaryContainer);

  if (preservedRecords.length > 0) {
    section.appendChild(
      el("p", { class: "achievement-note" }, [
        `ⓘ 이 모드에서 편집할 수 없는 항목 ${preservedRecords.length}건(정밀입력 원자료 또는 P/F·기타 유형)이 원본 데이터에 보존되어 있습니다. 저장/Excel 출력에 그대로 포함되며, 이 화면에서 수정되지 않습니다.`,
      ])
    );
  }

  return section;
}

function renderSubjectBlock(subject: string): HTMLElement {
  const block = el("div", { class: "subject-block", "data-subject": subject });
  renderSubjectBlockContents(block, subject);
  return block;
}

function renderSubjectBlockContents(block: HTMLElement, subject: string): void {
  clear(block);
  const entries = quickEntries[subject] ?? (quickEntries[subject] = []);

  const head = el("div", { class: "subject-block-head" }, [el("div", { class: "subject-name" }, [subject])]);
  block.appendChild(head);

  const rows = el("div", { class: "entry-rows" });
  for (const entry of entries) {
    rows.appendChild(renderEntryRow(subject, entry));
  }
  block.appendChild(rows);

  const addBtn = el("button", { class: "add-entry-btn", type: "button" }, ["+ 입력 추가"]);
  addBtn.addEventListener("click", () => {
    entries.push({ entryId: generateId("entry"), gradeLevel: getStudentCurrentGrade(), semester: 1, periodSpecified: true, courseName: "", evaluationType: "rankGrade", gradeScale });
    renderSubjectBlockContents(block, subject);
    refreshGradeSummary();
  });
  block.appendChild(addBtn);

  const achieved = entries.filter((e) => e.evaluationType === "achievement" && e.achievement);
  if (achieved.length > 0) {
    const note = achieved.map((e) => `${e.achievement}/${e.credits ?? "-"}단위`).join(", ");
    block.appendChild(el("div", { class: "achievement-note" }, [`ⓘ 성취평가(평균 제외): ${note}`]));
  }
}

function renderEntryRow(subject: string, entry: QuickEntry): HTMLElement {
  const row = el("div", { class: "entry-row", "data-entry-id": entry.entryId });
  const effectiveScale = entry.gradeScale ?? gradeScale;

  const periodSelect = el("select", { title: "이수 학기" }) as HTMLSelectElement;
  periodSelect.appendChild(el("option", { value: "aggregate" }, ["누적/미지정"]) as HTMLOptionElement);
  for (const semester of COUNSELING_SEMESTERS) {
    periodSelect.appendChild(el("option", { value: semester.key }, [semester.label]) as HTMLOptionElement);
  }
  periodSelect.value = entry.periodSpecified ? `${entry.gradeLevel ?? getStudentCurrentGrade()}-${entry.semester ?? 1}` : "aggregate";
  periodSelect.addEventListener("change", () => {
    if (periodSelect.value === "aggregate") {
      entry.periodSpecified = false;
      entry.gradeLevel = undefined;
      entry.semester = undefined;
    } else {
      const [g, sem] = periodSelect.value.split("-").map(Number);
      entry.periodSpecified = true;
      entry.gradeLevel = g as 1 | 2 | 3;
      entry.semester = sem as 1 | 2;
    }
    refreshGradeSummary();
    scheduleAutosave();
  });

  const courseInput = el("input", {
    type: "text",
    class: "course-name-input",
    placeholder: "과목명(선택)",
    value: entry.courseName ?? "",
  }) as HTMLInputElement;
  courseInput.addEventListener("input", () => {
    entry.courseName = courseInput.value;
    scheduleAutosave();
  });

  const typeSelect = el("select", {}) as HTMLSelectElement;
  typeSelect.append(
    el("option", { value: "rankGrade" }, ["등급"]) as HTMLOptionElement,
    el("option", { value: "achievement" }, ["성취평가"]) as HTMLOptionElement
  );
  typeSelect.value = entry.evaluationType;
  typeSelect.addEventListener("change", () => {
    entry.evaluationType = typeSelect.value as "rankGrade" | "achievement";
    const block = row.closest(".subject-block") as HTMLElement;
    renderSubjectBlockContents(block, subject);
    refreshGradeSummary();
    scheduleAutosave();
  });

  const creditsInput = el("input", {
    type: "number",
    min: "0",
    max: "20",
    step: "1",
    placeholder: "단위",
    value: entry.credits != null ? String(entry.credits) : "",
  }) as HTMLInputElement;
  creditsInput.addEventListener("input", () => {
    const v = creditsInput.valueAsNumber;
    const check = validateCredits(v);
    creditsInput.setCustomValidity(check.valid ? "" : check.message ?? "");
    entry.credits = isNaN(v) ? undefined : v;
    refreshGradeSummary();
    scheduleAutosave();
  });

  row.append(periodSelect, courseInput, typeSelect, creditsInput, el("span", { class: "unit-label" }, ["단위"]));

  if (entry.evaluationType === "rankGrade") {
    if (!entry.gradeScale) entry.gradeScale = gradeScale;
    const scaleSelect = el("select", { title: "이 과목의 등급체계" }) as HTMLSelectElement;
    scaleSelect.append(
      el("option", { value: "5" }, ["5등급"]) as HTMLOptionElement,
      el("option", { value: "9" }, ["9등급"]) as HTMLOptionElement
    );
    scaleSelect.value = String(effectiveScale);
    scaleSelect.addEventListener("change", () => {
      entry.gradeScale = Number(scaleSelect.value) as GradeScale;
      gradeInput.max = String(entry.gradeScale);
      refreshGradeSummary();
      scheduleAutosave();
    });

    const gradeInput = el("input", {
      type: "number",
      min: "1",
      max: String(effectiveScale),
      step: "1",
      placeholder: "등급",
      value: entry.rankGrade != null ? String(entry.rankGrade) : "",
    }) as HTMLInputElement;
    gradeInput.addEventListener("input", () => {
      const v = gradeInput.valueAsNumber;
      const check = validateRankGrade(v, entry.gradeScale ?? gradeScale);
      gradeInput.setCustomValidity(check.valid ? "" : check.message ?? "");
      entry.rankGrade = isNaN(v) ? undefined : v;
      refreshGradeSummary();
      scheduleAutosave();
    });

    const conversionHint = el("span", { class: "entry-conversion-hint" }, []);
    const updateConversionHint = () => {
      const scale = entry.gradeScale ?? gradeScale;
      if (entry.rankGrade == null || !Number.isFinite(entry.rankGrade)) {
        conversionHint.textContent = "9환산 -";
        return;
      }
      const converted = scale === 9 ? entry.rankGrade : convertFiveGradeAverageToNine(entry.rankGrade);
      conversionHint.textContent = `9환산 ${converted == null ? "-" : converted.toFixed(2)}`;
    };
    scaleSelect.addEventListener("change", updateConversionHint);
    gradeInput.addEventListener("input", updateConversionHint);
    updateConversionHint();
    row.append(scaleSelect, gradeInput, el("span", { class: "unit-label" }, ["등급"]), conversionHint);
  } else {
    const achSelect = el("select", {}) as HTMLSelectElement;
    achSelect.append(
      el("option", { value: "" }, ["-"]) as HTMLOptionElement,
      el("option", { value: "A" }, ["A"]) as HTMLOptionElement,
      el("option", { value: "B" }, ["B"]) as HTMLOptionElement,
      el("option", { value: "C" }, ["C"]) as HTMLOptionElement,
      el("option", { value: "D" }, ["D"]) as HTMLOptionElement,
      el("option", { value: "E" }, ["E"]) as HTMLOptionElement
    );
    achSelect.value = entry.achievement ?? "";
    achSelect.addEventListener("change", () => {
      entry.achievement = (achSelect.value || undefined) as AchievementLevel | undefined;
      const block = row.closest(".subject-block") as HTMLElement;
      renderSubjectBlockContents(block, subject);
      refreshGradeSummary();
      scheduleAutosave();
    });
    row.appendChild(achSelect);
  }

  const removeBtn = el("button", { class: "remove-btn", type: "button", "aria-label": "삭제" }, ["✕"]);
  removeBtn.addEventListener("click", () => {
    const list = quickEntries[subject];
    quickEntries[subject] = list.filter((e) => e.entryId !== entry.entryId);
    const block = row.closest(".subject-block") as HTMLElement;
    renderSubjectBlockContents(block, subject);
    refreshGradeSummary();
    scheduleAutosave();
  });
  row.appendChild(removeBtn);

  return row;
}

/** 빠른입력 상태(quickEntries) + 보존 레코드 → AcademicRecord[] 변환. 계산엔진은 항상 이 형태로 받는다. */
function recordsFromQuickEntries(): AcademicRecord[] {
  const records: AcademicRecord[] = [];
  for (const subject of SUBJECT_GROUPS) {
    const entries = quickEntries[subject] ?? [];
    entries.forEach((e, idx) => {
      if (e.credits == null || e.credits <= 0) return; // 미입력 항목은 계산에서 제외
      if (e.evaluationType === "rankGrade" && e.rankGrade == null) return;
      if (e.evaluationType === "achievement" && !e.achievement) return;
      const gradeLevel = e.periodSpecified ? e.gradeLevel ?? getStudentCurrentGrade() : getStudentCurrentGrade();
      const semester = e.periodSpecified ? e.semester ?? 1 : 1;
      const academicYear = e.periodSpecified ? academicYearForGradeLevel(gradeLevel) : getCurrentAcademicYear();
      records.push({
        id: e.entryId,
        academicYear,
        gradeLevel,
        semester,
        subjectGroup: subject,
        courseName: e.courseName?.trim() || `${subject} 항목${idx + 1}`,
        credits: e.credits,
        evaluationType: e.evaluationType,
        gradeScale: e.evaluationType === "rankGrade" ? e.gradeScale ?? gradeScale : undefined,
        rankGrade: e.evaluationType === "rankGrade" ? e.rankGrade : undefined,
        achievement: e.evaluationType === "achievement" ? e.achievement : undefined,
        sourceMode: e.periodSpecified ? "quickSemester" : "quickAggregate",
      });
    });
  }
  return [...records, ...preservedRecords];
}

function refreshGradeSummary(): void {
  state.academicRecords = recordsFromQuickEntries();
  if (gradeSectionSummaryContainer) renderGradeSummaryInto(gradeSectionSummaryContainer);
  refreshTargetSection();
}

function formatNineGradeEquivalent(result: ReturnType<typeof computeWeightedAverage>): string {
  return formatGrade(convertWeightedAverageToNine(result));
}

function buildDualGradeCell(result: ReturnType<typeof computeWeightedAverage>): HTMLElement {
  const raw = formatGrade(result.average);
  const converted = formatNineGradeEquivalent(result);
  return el("div", { class: "grade-pair" }, [
    el("span", { class: "grade-pair-raw" }, [raw]),
    el("span", { class: "grade-pair-converted" }, [`9환산 ${converted}`]),
  ]);
}

function renderGradeSummaryInto(container: HTMLElement): void {
  clear(container);
  const records = state.academicRecords;
  const bySubject = computeBySubjectGroup(records);
  const combos = REFERENCE_COMBINATIONS.map((def) => ({
    def,
    result: computeCombination(records, def.subjectGroups),
  }));
  // 전교과는 고정 교과군 목록으로 필터링하지 않고 전체 원자료를 그대로 사용한다
  // (자유 입력 교과군이 SUBJECT_GROUPS 목록에 없더라도 누락되지 않도록).
  const comboAll = computeWeightedAverage(records);

  const table = el("table", { class: "ledger" });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["구분"]),
      el("th", { class: "num" }, ["단위수"]),
      el("th", { class: "num" }, ["가중평균(원등급)"]),
      el("th", { class: "num" }, ["9등급 환산"]),
      el("th", {}, ["근거"]),
    ]),
  ]);
  table.appendChild(thead);
  const tbody = el("tbody", {});

  for (const g of bySubject) {
    if (g.result.courseCount === 0 && g.result.excludedAchievementCourses.length === 0) continue;
    tbody.appendChild(buildLedgerRow(g.subjectGroup, g.result.totalCredits, formatGrade(g.result.average), formatNineGradeEquivalent(g.result), buildEvidenceText(g.result)));
  }

  const divider = el("tr", { class: "combo-row" }, [el("td", { colSpan: "5" }, ["참고용 교과 조합 (아직 특정 대학 규칙과 연결되지 않음)"])]);
  tbody.appendChild(divider);
  for (const c of combos) {
    tbody.appendChild(buildLedgerRow(c.def.label, c.result.totalCredits, formatGrade(c.result.average), formatNineGradeEquivalent(c.result), buildEvidenceText(c.result), true));
  }
  tbody.appendChild(
    buildLedgerRow("등급 산출과목 전교과", comboAll.totalCredits, formatGrade(comboAll.average), formatNineGradeEquivalent(comboAll), buildEvidenceText(comboAll), true)
  );

  table.appendChild(tbody);
  container.appendChild(table);

  const semesterAware = getSemesterAwareRecords(records);
  const matrix = computeSemesterCombinationMatrix(records, REFERENCE_COMBINATIONS);
  const semesterRows = matrix.filter((row) => row.semester != null);
  const recognizedSemesterCount = semesterRows.filter((row) => row.records.length > 0).length;
  const missingSemesterLabels = semesterRows
    .filter((row) => row.records.length === 0)
    .map((row) => row.label);
  container.appendChild(
    el("h3", { class: "analysis-subtitle" }, [
      "학기별 교과 조합 가중평균 ",
      el("span", { class: "feature-badge" }, [`${recognizedSemesterCount}/5학기 인식`]),
    ])
  );
  const matrixTable = el("table", { class: "ledger semester-matrix" });
  const matrixHead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, ["학기"]),
      ...REFERENCE_COMBINATIONS.map((c) => el("th", { class: "num" }, [c.label])),
      el("th", { class: "num" }, ["전교과"]),
    ]),
  ]);
  const matrixBody = el("tbody", {});
  for (const row of matrix) {
    matrixBody.appendChild(
      el("tr", row.semester == null ? { class: "combo-row total-row" } : {}, [
        el("td", {}, [row.label]),
        ...REFERENCE_COMBINATIONS.map((c) =>
          el("td", { class: "num" }, [buildDualGradeCell(row.combinations[c.id])])
        ),
        el("td", { class: "num" }, [buildDualGradeCell(row.allSubjects)]),
      ])
    );
  }
  matrixTable.append(matrixHead, matrixBody);
  container.appendChild(matrixTable);
  if (missingSemesterLabels.length > 0 && semesterAware.length > 0) {
    container.appendChild(
      el("p", { class: "achievement-note warning-note" }, [
        `⚠ 현재 ${recognizedSemesterCount}/5학기만 인식되었습니다. 누락: ${missingSemesterLabels.join(", ")}. ` +
          "PDF/사진 자동추출 검토표에서 학년·학기 배정을 확인하거나 해당 학기 자료를 다시 추가해 주세요.",
      ])
    );
  }
  container.appendChild(
    el("p", { class: "achievement-note" }, [
      semesterAware.length > 0
        ? "전체 값은 인식된 모든 등급 산출과목을 합쳐 Σ(단위수×등급)÷Σ단위수로 다시 계산합니다. 5개 학기가 모두 인식된 경우에만 ‘5개 학기’ 전체값으로 볼 수 있습니다. 5등급제 결과는 제공된 Excel 환산표의 근사 VLOOKUP 방식으로 9등급 참고값을 함께 표시합니다."
        : "아직 학기 정보가 있는 성적이 없습니다. PDF/사진에서 성적을 불러오거나 수동 입력행의 ‘이수 학기’를 선택하면 위 표가 자동으로 채워집니다.",
    ])
  );

  if (comboAll.mixedGradeScaleWarning) {
    container.appendChild(
      el("p", { class: "achievement-note" }, [
        "⚠ 서로 다른 등급체계(5등급제/9등급제)의 과목이 섞여 있어 전교과 가중평균을 계산하지 않았습니다. 각 항목의 등급체계를 확인해 주세요.",
      ])
    );
  }

  if (comboAll.invalidCourses.length > 0) {
    container.appendChild(
      el("p", { class: "achievement-note" }, [
        `⚠ 계산에서 제외된 비정상 성적 ${comboAll.invalidCourses.length}건: ` +
          comboAll.invalidCourses.map((c) => `${c.courseName}(${c.reason})`).join(", "),
      ])
    );
  }
}

function buildEvidenceText(result: ReturnType<typeof computeCombination>): string {
  const lines = [`산출과목 ${result.courseCount}개, 총 ${result.totalCredits}단위`, `계산식: Σ(단위수×등급) ÷ Σ단위수`];
  if (result.excludedAchievementCourses.length > 0) {
    lines.push(`성취평가 제외: ${result.excludedAchievementCourses.map((c) => `${c.courseName}(${c.achievement})`).join(", ")}`);
  }
  if (result.invalidCourses.length > 0) {
    lines.push(`⚠ 값 이상으로 제외: ${result.invalidCourses.map((c) => `${c.courseName}(${c.reason})`).join(", ")}`);
  }
  if (result.mixedGradeScaleWarning) {
    lines.push("⚠ 등급체계 혼재로 평균 미계산");
  } else if (result.gradeScale === 5 && result.average.kind === "value") {
    lines.push(`9등급 환산(참고): ${formatNineGradeEquivalent(result)} — 제공 Excel 환산표 근사 VLOOKUP 기준`);
  } else if (result.gradeScale === 9 && result.average.kind === "value") {
    lines.push(`9등급 환산: 원 9등급 값과 동일(${formatNineGradeEquivalent(result)})`);
  }
  return lines.join("\n");
}

function buildLedgerRow(label: string, credits: number, avgText: string, convertedText: string, evidence: string, bold = false): DocumentFragment {
  const tr = el("tr", bold ? { class: "combo-row" } : {});
  const avgCell = el("td", { class: "num" }, [
    avgText === "-" ? el("span", { class: "empty-value" }, ["-"]) : document.createTextNode(avgText),
  ]);
  const convertedCell = el("td", { class: "num converted-grade-cell" }, [
    convertedText === "-" ? el("span", { class: "empty-value" }, ["-"]) : document.createTextNode(convertedText),
  ]);
  const toggleBtn = el("button", { class: "info-toggle", type: "button" }, ["ⓘ"]);
  const evidenceBox = el("div", { class: "evidence-box" }, [evidence]);
  toggleBtn.addEventListener("click", () => evidenceBox.classList.toggle("open"));

  const evidenceCell = el("td", {}, [toggleBtn]);

  tr.append(
    el("td", {}, [label]),
    el("td", { class: "num" }, [credits > 0 ? String(credits) : "-"]),
    avgCell,
    convertedCell,
    evidenceCell
  );

  // 결과행 + 근거(펼침) 행을 함께 tbody에 삽입하기 위해 DocumentFragment로 묶어 반환한다.
  const frag = document.createDocumentFragment();
  frag.append(tr, el("tr", {}, [el("td", { colSpan: "5", style: "padding:0 0 4px;border:none;" }, [evidenceBox])]));
  return frag;
}

// ─────────────────────────────────────────────────────────
// 목표등급 계산
// ─────────────────────────────────────────────────────────

let targetSectionBody: HTMLElement;
let targetInputRef: HTMLInputElement;

function renderTargetSection(): HTMLElement {
  const section = el("section", { class: "card" });
  section.append(
    el("h2", {}, [el("span", { class: "section-number" }, ["02"]), "목표등급 역산"]),
    el("p", { class: "card-desc" }, [
      "현재까지의 '등급 산출과목 전교과' 가중평균을 기준으로, 앞으로 남은 단위수 동안 어떤 평균을 받아야 목표에 도달하는지 계산합니다. ",
      "등급은 숫자가 작을수록 좋은 성적입니다. 등급체계는 01번에 입력된 실제 성적을 기준으로 자동 판단합니다(상단의 '기본 등급체계' 선택과는 무관합니다).",
    ])
  );

  const form = el("div", { class: "field-row" });
  const futureCreditsField = el("div", { class: "field" }, ["앞으로 이수할 단위수"]);
  const futureCreditsInput = el("input", { type: "number", min: "0", placeholder: "예: 25" }) as HTMLInputElement;
  futureCreditsField.appendChild(futureCreditsInput);

  const targetField = el("div", { class: "field" }, ["목표 누적등급 (이 수치 이하가 되도록)"]);
  targetInputRef = el("input", {
    type: "number",
    min: "1",
    step: "0.01",
    placeholder: "예: 1.70",
  }) as HTMLInputElement;
  targetField.appendChild(targetInputRef);

  const calcBtn = el("button", { class: "btn secondary", type: "button" }, ["계산"]);
  form.append(futureCreditsField, targetField, calcBtn);
  section.appendChild(form);

  targetSectionBody = el("div", { class: "target-result table-scroll" });
  section.appendChild(targetSectionBody);

  calcBtn.addEventListener("click", () => {
    const F = futureCreditsInput.valueAsNumber;
    const T = targetInputRef.valueAsNumber;
    const activeScale = getActiveGradeScale(state.academicRecords);
    if (activeScale == null) {
      showToast("01번의 성적 데이터에서 등급체계를 판단할 수 없습니다 (미입력 또는 5/9등급 혼재).");
      return;
    }
    const check = validateTargetGrade(T, activeScale);
    if (!check.valid) {
      showToast(check.message ?? "목표 누적등급 값을 확인해 주세요.");
      return;
    }
    renderTargetResult(F, T);
  });

  return section;
}

function refreshTargetSection(): void {
  const activeScale = getActiveGradeScale(state.academicRecords);
  if (targetInputRef) targetInputRef.max = activeScale != null ? String(activeScale) : "";
  if (targetSectionBody && targetSectionBody.dataset.lastF && targetSectionBody.dataset.lastT) {
    renderTargetResult(Number(targetSectionBody.dataset.lastF), Number(targetSectionBody.dataset.lastT));
  }
}

function formatNineFromNumber(valueToConvert: number, gradeScaleToUse: GradeScale): string {
  if (!Number.isFinite(valueToConvert)) return "-";
  if (gradeScaleToUse === 9) return valueToConvert.toFixed(2);
  const converted = convertFiveGradeAverageToNine(valueToConvert);
  return converted == null ? "-" : converted.toFixed(2);
}

function renderTargetResult(futureCredits: number, targetGrade: number): void {
  if (!targetSectionBody) return;
  clear(targetSectionBody);
  if (isNaN(futureCredits) || isNaN(targetGrade) || futureCredits <= 0) {
    targetSectionBody.appendChild(
      el("p", { class: "card-desc" }, ["앞으로 이수할 단위수와 목표 누적등급을 입력한 뒤 계산 버튼을 눌러주세요."])
    );
    return;
  }
  targetSectionBody.dataset.lastF = String(futureCredits);
  targetSectionBody.dataset.lastT = String(targetGrade);

  const comboAll = computeWeightedAverage(state.academicRecords);
  if (comboAll.average.kind === "empty") {
    const msg = comboAll.mixedGradeScaleWarning
      ? "등급체계(5등급제/9등급제)가 섞여 있어 계산할 수 없습니다. 01번에서 각 항목의 등급체계를 확인해 주세요."
      : "먼저 위 01번에 현재까지의 성적을 입력해야 계산할 수 있습니다.";
    targetSectionBody.appendChild(el("p", { class: "card-desc" }, [msg]));
    return;
  }

  // 검수 지적 반영(P0): 상단 "새 항목 기본 등급체계" 선택값이 아니라, 실제 성적 데이터가
  // 쓰고 있는 등급체계를 근거로 계산한다. 데이터가 혼재되어 있으면(이론상 mixedGradeScaleWarning
  // 에서 이미 걸러지지만 이중 방어) 계산하지 않는다.
  const activeScale = getActiveGradeScale(state.academicRecords);
  if (activeScale == null) {
    targetSectionBody.appendChild(
      el("p", { class: "card-desc" }, ["01번의 성적 데이터에서 등급체계를 하나로 판단할 수 없어 계산할 수 없습니다."])
    );
    return;
  }

  const U = comboAll.totalCredits;
  const S = comboAll.average.value * U;

  const result = computeReverseTarget({
    currentCredits: U,
    currentScoreSum: S,
    futureCredits,
    targetCumulativeGrade: targetGrade,
    gradeScale: activeScale,
  });

  const badge = el("span", { class: `badge ${result.feasibility}` }, [
    result.feasibility === "achievable" ? "달성 가능" : result.feasibility === "impossible" ? "달성 불가" : "이미 확보",
  ]);

  const currentNine = formatGrade(convertGradeAverageToNine(comboAll.average, activeScale));
  const targetNine = formatNineFromNumber(targetGrade, activeScale);
  const requiredNine = result.requiredAverage.kind === "value"
    ? formatNineFromNumber(result.requiredAverage.value, activeScale)
    : "-";

  targetSectionBody.append(
    el("p", {}, [
      `현재 누적 ${formatGrade(comboAll.average)} (${U}단위, ${activeScale}등급제 · 9환산 ${currentNine}) → 목표 ${targetGrade.toFixed(2)} (9환산 ${targetNine}) 이하, 향후 ${futureCredits}단위 기준 `,
      badge,
    ]),
    el("p", { class: "card-desc", style: "white-space:pre-line;" }, [
      `${result.message}${result.requiredAverage.kind === "value" ? `\n필요 평균 9등급 환산 참고값: ${requiredNine}` : ""}`,
    ])
  );

  const scenarios = computeScenarios(U, S, futureCredits, activeScale);
  if (scenarios.length > 0) {
    const table = el("table", { class: "ledger" });
    table.append(
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, ["다음 구간 평균"]),
          el("th", { class: "num" }, ["9등급 환산"]),
          el("th", { class: "num" }, ["예상 누적등급"]),
          el("th", { class: "num" }, ["누적 9등급 환산"]),
        ]),
      ])
    );
    const tbody = el("tbody", {});
    for (const row of scenarios) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", {}, [row.futureAverage.toFixed(2)]),
          el("td", { class: "num" }, [formatNineFromNumber(row.futureAverage, activeScale)]),
          el("td", { class: "num" }, [formatGrade(row.expectedCumulative)]),
          el("td", { class: "num" }, [formatGrade(convertGradeAverageToNine(row.expectedCumulative, activeScale))]),
        ])
      );
    }
    table.appendChild(tbody);
    targetSectionBody.appendChild(table);
  }
}

// ─────────────────────────────────────────────────────────
// 모의고사 입력
// ─────────────────────────────────────────────────────────

let mockExamListContainer: HTMLElement;

function renderMockExamSection(): HTMLElement {
  const section = el("section", { class: "card" });
  section.append(
    el("h2", {}, [el("span", { class: "section-number" }, ["03"]), "모의고사 기록"]),
    el("p", { class: "card-desc" }, ["회차별로 등급·백분위를 기록해 두면 향후 수능최저 비교와 추세 확인에 사용할 수 있습니다."])
  );

  const form = el("div", { class: "field-row" });
  const labelF = mkField("회차", "text", "예: 9월");
  const korG = mkField("국어 등급", "number");
  const korP = mkField("국어 백분위", "number");
  const mathG = mkField("수학 등급", "number");
  const mathP = mkField("수학 백분위", "number");
  const engG = mkField("영어 등급", "number");
  const inq1G = mkField("탐구1 등급", "number");
  const inq1P = mkField("탐구1 백분위", "number");
  const inq2G = mkField("탐구2 등급", "number");
  const inq2P = mkField("탐구2 백분위", "number");
  const historyG = mkField("한국사 등급", "number");
  form.append(
    labelF.field,
    korG.field,
    korP.field,
    mathG.field,
    mathP.field,
    engG.field,
    inq1G.field,
    inq1P.field,
    inq2G.field,
    inq2P.field,
    historyG.field
  );

  const addBtn = el("button", { class: "btn secondary", type: "button" }, ["추가"]);
  form.appendChild(addBtn);
  section.appendChild(form);

  mockExamListContainer = el("div", { class: "table-scroll" });
  section.appendChild(mockExamListContainer);
  renderMockExamList();

  addBtn.addEventListener("click", () => {
    if (!labelF.input.value.trim()) {
      showToast("회차를 입력해 주세요 (예: 9월).");
      return;
    }
    const grades = [korG, mathG, engG, inq1G, inq2G, historyG];
    for (const g of grades) {
      const check = validateMockExamGrade(numOrUndef(g.input.value) as number);
      if (!check.valid) {
        showToast(check.message ?? "등급 값을 확인해 주세요.");
        return;
      }
    }
    const pcts = [korP, mathP, inq1P, inq2P];
    for (const p of pcts) {
      const check = validatePercentile(numOrUndef(p.input.value) as number);
      if (!check.valid) {
        showToast(check.message ?? "백분위 값을 확인해 주세요.");
        return;
      }
    }
    const rec: MockExamRecord = {
      id: generateId("mock"),
      academicYear: getCurrentAcademicYear(),
      examLabel: labelF.input.value.trim(),
      korean: buildScoreField(korG.input.value, korP.input.value),
      math: buildScoreField(mathG.input.value, mathP.input.value),
      english: numOrUndef(engG.input.value) != null ? { grade: numOrUndef(engG.input.value) } : undefined,
      inquiry1: buildScoreField(inq1G.input.value, inq1P.input.value),
      inquiry2: buildScoreField(inq2G.input.value, inq2P.input.value),
      koreanHistory: numOrUndef(historyG.input.value) != null ? { grade: numOrUndef(historyG.input.value) } : undefined,
    };
    state.mockExams.push(rec);
    [labelF, korG, korP, mathG, mathP, engG, inq1G, inq1P, inq2G, inq2P, historyG].forEach((f) => (f.input.value = ""));
    renderMockExamList();
    scheduleAutosave();
  });

  return section;
}

function buildScoreField(gradeStr: string, percentileStr: string): { grade?: number; percentile?: number } | undefined {
  const grade = numOrUndef(gradeStr);
  const percentile = numOrUndef(percentileStr);
  if (grade == null && percentile == null) return undefined;
  return { grade, percentile };
}

function renderMockExamList(): void {
  clear(mockExamListContainer);
  if (state.mockExams.length === 0) {
    mockExamListContainer.appendChild(el("p", { class: "card-desc" }, ["아직 입력된 모의고사 기록이 없습니다."]));
    return;
  }
  const table = el("table", { class: "ledger" });
  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["회차"]),
        el("th", { class: "num" }, ["국어(등급/백분위)"]),
        el("th", { class: "num" }, ["수학(등급/백분위)"]),
        el("th", { class: "num" }, ["영어"]),
        el("th", { class: "num" }, ["탐구1(등급/백분위)"]),
        el("th", { class: "num" }, ["탐구2(등급/백분위)"]),
        el("th", { class: "num" }, ["한국사"]),
        el("th", { class: "num" }, ["국+수+탐구1 백분위합"]),
        el("th", {}, [""]),
      ]),
    ])
  );
  const tbody = el("tbody", {});
  for (const m of state.mockExams) {
    const removeBtn = el("button", { class: "remove-btn", type: "button" }, ["✕"]);
    removeBtn.addEventListener("click", () => {
      state.mockExams = state.mockExams.filter((r) => r.id !== m.id);
      renderMockExamList();
      scheduleAutosave();
    });
    const pctSum =
      m.korean?.percentile != null && m.math?.percentile != null && m.inquiry1?.percentile != null
        ? m.korean.percentile + m.math.percentile + m.inquiry1.percentile
        : undefined;
    tbody.appendChild(
      el("tr", {}, [
        el("td", {}, [m.examLabel]),
        el("td", { class: "num" }, [scorePairText(m.korean)]),
        el("td", { class: "num" }, [scorePairText(m.math)]),
        el("td", { class: "num" }, [m.english?.grade != null ? String(m.english.grade) : "-"]),
        el("td", { class: "num" }, [scorePairText(m.inquiry1)]),
        el("td", { class: "num" }, [scorePairText(m.inquiry2)]),
        el("td", { class: "num" }, [m.koreanHistory?.grade != null ? String(m.koreanHistory.grade) : "-"]),
        el("td", { class: "num" }, [pctSum != null ? String(pctSum) : "-"]),
        el("td", {}, [removeBtn]),
      ])
    );
  }
  table.appendChild(tbody);
  mockExamListContainer.appendChild(table);
}

function scorePairText(s?: { grade?: number; percentile?: number }): string {
  if (!s || (s.grade == null && s.percentile == null)) return "-";
  return `${s.grade ?? "-"} / ${s.percentile ?? "-"}`;
}

// ─────────────────────────────────────────────────────────
// 대학 조사 (수시 상담 카드)
// ─────────────────────────────────────────────────────────

let universityListContainer: HTMLElement;

function renderUniversitySection(): HTMLElement {
  const section = el("section", { class: "card" });
  section.append(
    el("h2", {}, [el("span", { class: "section-number" }, ["04"]), "대학 조사 (수시 상담 카드)"]),
    el("p", { class: "card-desc" }, [
      "관심 대학의 전형 정보를 입력하고, 최근 3개년 입시결과는 직접 조사해 채워보세요. ",
      "스스로 자료를 찾아 입력하는 과정 자체가 중요한 탐구활동입니다. 등록 후에도 카드 안의 값을 자유롭게 수정할 수 있습니다.",
    ])
  );

  const form = el("div", { class: "field-row" });
  const univ = mkField("대학", "text");
  const major = mkField("학과", "text");
  const admType = mkField("전형", "text");
  const ratio = mkField("반영비율", "text");
  const subjects = mkField("반영교과", "text");
  const gradeWeight = mkField("학년별 비율", "text", "예: 1학년20:2학년40:3학년40");
  const csat = mkField("수능최저(공통)", "text");
  const myGrade = mkField("본인 환산성적", "number");
  form.append(univ.field, major.field, admType.field, ratio.field, subjects.field, gradeWeight.field, csat.field, myGrade.field);

  const addBtn = el("button", { class: "btn secondary", type: "button" }, ["대학 추가"]);
  form.appendChild(addBtn);
  section.appendChild(form);

  universityListContainer = el("div", { class: "app-list" });
  section.appendChild(universityListContainer);
  renderUniversityList();

  addBtn.addEventListener("click", () => {
    if (!univ.input.value.trim() || !major.input.value.trim()) {
      showToast("대학명과 학과명을 입력해 주세요.");
      return;
    }
    const app: ApplicationRecord = {
      id: generateId("app"),
      universityName: univ.input.value.trim(),
      majorName: major.input.value.trim(),
      admissionType: admType.input.value.trim() || "교과",
      reflectionRatio: ratio.input.value.trim() || undefined,
      reflectionSubjects: subjects.input.value.trim() || undefined,
      gradeWeightNote: gradeWeight.input.value.trim() || undefined,
      csatMinimum: csat.input.value.trim() || undefined,
      myConvertedGrade: numOrUndef(myGrade.input.value),
      yearlyData: [],
    };
    state.applications.push(app);
    [univ, major, admType, ratio, subjects, gradeWeight, csat, myGrade].forEach((f) => (f.input.value = ""));
    renderUniversityList();
    scheduleAutosave();
  });

  return section;
}

function renderUniversityList(): void {
  clear(universityListContainer);
  if (state.applications.length === 0) {
    universityListContainer.appendChild(el("p", { class: "card-desc" }, ["아직 조사한 대학이 없습니다."]));
    return;
  }
  for (const app of state.applications) {
    universityListContainer.appendChild(renderApplicationCard(app));
  }
}

/** 라벨 + 값을 즉시 편집 가능한 인라인 입력으로 렌더링한다 (검수 지적: 잘못 입력한
 *  대학 기본정보를 고치려면 전체 삭제 후 재입력해야 했던 문제를 해결). */
function editableField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = el("div", { class: "field" }, [label]);
  const input = el("input", { type: "text", value }) as HTMLInputElement;
  input.addEventListener("input", () => {
    onChange(input.value);
    scheduleAutosave();
  });
  wrap.appendChild(input);
  return wrap;
}

function renderApplicationCard(app: ApplicationRecord): HTMLElement {
  const card = el("div", { class: "app-card" });
  const removeBtn = el("button", { class: "btn danger", type: "button" }, ["삭제"]);
  removeBtn.addEventListener("click", () => {
    state.applications = state.applications.filter((a) => a.id !== app.id);
    renderUniversityList();
    scheduleAutosave();
  });
  card.appendChild(
    el("div", { class: "app-card-head" }, [el("strong", {}, [`${app.universityName} · ${app.majorName}`]), removeBtn])
  );

  const editRow = el("div", { class: "field-row" }, [
    editableField("대학", app.universityName, (v) => {
      app.universityName = v || app.universityName;
      updateCardTitle(card, app);
    }),
    editableField("학과", app.majorName, (v) => {
      app.majorName = v || app.majorName;
      updateCardTitle(card, app);
    }),
    editableField("전형", app.admissionType, (v) => (app.admissionType = v)),
    editableField("반영비율", app.reflectionRatio ?? "", (v) => (app.reflectionRatio = v || undefined)),
    editableField("반영교과", app.reflectionSubjects ?? "", (v) => (app.reflectionSubjects = v || undefined)),
    editableField("학년별 비율", app.gradeWeightNote ?? "", (v) => (app.gradeWeightNote = v || undefined)),
    editableField("수능최저(공통)", app.csatMinimum ?? "", (v) => (app.csatMinimum = v || undefined)),
  ]);
  card.appendChild(editRow);

  const myGradeField = el("div", { class: "field" }, ["본인 환산성적"]);
  const myGradeInput = el("input", { type: "number", value: app.myConvertedGrade != null ? String(app.myConvertedGrade) : "" }) as HTMLInputElement;
  myGradeInput.addEventListener("input", () => {
    app.myConvertedGrade = numOrUndef(myGradeInput.value);
    scheduleAutosave();
  });
  myGradeField.appendChild(myGradeInput);
  card.appendChild(myGradeField);

  const yearRow = el("div", { class: "year-row" });
  const yearInput = el("input", { placeholder: "연도" }) as HTMLInputElement;
  const recruitInput = el("input", { placeholder: "모집인원" }) as HTMLInputElement;
  const compInput = el("input", { placeholder: "경쟁률" }) as HTMLInputElement;
  const addInput = el("input", { placeholder: "충원" }) as HTMLInputElement;
  const cutInput = el("input", { placeholder: "70%컷" }) as HTMLInputElement;
  const finalInput = el("input", { placeholder: "최종" }) as HTMLInputElement;
  const yearCsatInput = el("input", { placeholder: "그 해 수능최저" }) as HTMLInputElement;
  const addYearBtn = el("button", { class: "add-entry-btn", type: "button" }, ["+ 연도 자료 추가"]);
  addYearBtn.addEventListener("click", () => {
    const year = Number(yearInput.value);
    const yearCheck = validateYear(year);
    if (!yearCheck.valid) {
      showToast(yearCheck.message ?? "연도를 확인해 주세요.");
      return;
    }
    const recruit = numOrUndef(recruitInput.value);
    const recruitCheck = validateNonNegativeInteger(recruit as number, "모집인원");
    const comp = numOrUndef(compInput.value);
    const compCheck = validateNonNegativeNumber(comp as number, "경쟁률");
    const additional = numOrUndef(addInput.value);
    const additionalCheck = validateNonNegativeInteger(additional as number, "충원");
    const cut70 = numOrUndef(cutInput.value);
    const cut70Check = validateNonNegativeNumber(cut70 as number, "70%컷");
    const finalCut = numOrUndef(finalInput.value);
    const finalCutCheck = validateNonNegativeNumber(finalCut as number, "최종컷");
    for (const check of [recruitCheck, compCheck, additionalCheck, cut70Check, finalCutCheck]) {
      if (!check.valid) {
        showToast(check.message ?? "값을 확인해 주세요.");
        return;
      }
    }
    app.yearlyData = app.yearlyData ?? [];
    app.yearlyData.push({
      year,
      recruitCount: recruit,
      competitionRate: comp,
      additionalAdmit: additional,
      cut70,
      finalCut,
      csatMinimum: yearCsatInput.value.trim() || undefined,
    });
    renderUniversityList();
    scheduleAutosave();
  });
  yearRow.append(yearInput, recruitInput, compInput, addInput, cutInput, finalInput, yearCsatInput, addYearBtn);
  card.appendChild(yearRow);

  if (app.yearlyData && app.yearlyData.length > 0) {
    const tableWrap = el("div", { class: "table-scroll" });
    const table = el("table", { class: "ledger" });
    table.append(
      el("thead", {}, [
        el("tr", {}, ["연도", "모집인원", "경쟁률", "충원", "70%컷", "최종", "그 해 수능최저", ""].map((h) => el("th", {}, [h]))),
      ])
    );
    const tbody = el("tbody", {});
    app.yearlyData.forEach((y, idx) => {
      const removeYearBtn = el("button", { class: "remove-btn", type: "button", "aria-label": "연도 자료 삭제" }, ["✕"]);
      removeYearBtn.addEventListener("click", () => {
        app.yearlyData!.splice(idx, 1);
        renderUniversityList();
        scheduleAutosave();
      });
      // 검수 지적: 잘못 입력한 연도 자료를 고치려면 삭제 후 재입력해야 했던 문제 →
      // 각 셀을 직접 편집 가능한 인라인 입력으로 렌더링한다.
      tbody.appendChild(
        el("tr", {}, [
          yearlyEditableCell(y, "year", validateYear),
          yearlyEditableCell(y, "recruitCount", (v) => validateNonNegativeInteger(v, "모집인원")),
          yearlyEditableCell(y, "competitionRate", (v) => validateNonNegativeNumber(v, "경쟁률")),
          yearlyEditableCell(y, "additionalAdmit", (v) => validateNonNegativeInteger(v, "충원")),
          yearlyEditableCell(y, "cut70", (v) => validateNonNegativeNumber(v, "70%컷")),
          yearlyEditableCell(y, "finalCut", (v) => validateNonNegativeNumber(v, "최종컷")),
          yearlyTextCell(y, "csatMinimum"),
          el("td", {}, [removeYearBtn]),
        ])
      );
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);
  }

  const memoField = el("div", { class: "field", style: "margin-top:8px;" }, ["상담메모"]);
  const memoInput = el("textarea", { placeholder: "이 대학/학과에 대한 상담 메모" }) as HTMLTextAreaElement;
  memoInput.value = app.memo ?? "";
  memoInput.addEventListener("input", () => {
    app.memo = memoInput.value;
    scheduleAutosave();
  });
  memoField.appendChild(memoInput);
  card.appendChild(memoField);

  return card;
}

function updateCardTitle(card: HTMLElement, app: ApplicationRecord): void {
  const strong = card.querySelector(".app-card-head strong");
  if (strong) strong.textContent = `${app.universityName} · ${app.majorName}`;
}

type YearlyEntry = NonNullable<ApplicationRecord["yearlyData"]>[number];

/** 연도별 조사 표의 숫자 셀을 즉시 편집 가능한 입력으로 렌더링한다. */
function yearlyEditableCell(
  y: YearlyEntry,
  key: "year" | "recruitCount" | "competitionRate" | "additionalAdmit" | "cut70" | "finalCut",
  validate: (v: number) => { valid: boolean; message?: string }
): HTMLElement {
  const td = el("td", { class: "num" });
  const input = el("input", { type: "number", value: y[key] != null ? String(y[key]) : "" }) as HTMLInputElement;
  input.addEventListener("input", () => {
    const v = input.valueAsNumber;
    const check = validate(v);
    input.setCustomValidity(check.valid ? "" : check.message ?? "");
    if (check.valid) {
      (y as any)[key] = isNaN(v) ? undefined : v;
      scheduleAutosave();
    }
  });
  td.appendChild(input);
  return td;
}

function yearlyTextCell(y: YearlyEntry, key: "csatMinimum"): HTMLElement {
  const td = el("td", { class: "num" });
  const input = el("input", { type: "text", value: y[key] ?? "" }) as HTMLInputElement;
  input.addEventListener("input", () => {
    y[key] = input.value.trim() || undefined;
    scheduleAutosave();
  });
  td.appendChild(input);
  return td;
}

// ─────────────────────────────────────────────────────────
// 전체 상담 메모
// ─────────────────────────────────────────────────────────

function renderMemoSection(): HTMLElement {
  const section = el("section", { class: "card" });
  section.append(
    el("h2", {}, [el("span", { class: "section-number" }, ["05"]), "상담 메모"]),
    el("p", { class: "card-desc" }, ["특정 대학에 속하지 않는 전반적인 상담 기록을 남겨두세요. (Excel의 05_상담메모 시트에 포함됩니다)"])
  );
  const textarea = el("textarea", { style: "width:100%;" }) as HTMLTextAreaElement;
  textarea.value = state.notes ?? "";
  textarea.addEventListener("input", () => {
    state.notes = textarea.value;
    scheduleAutosave();
  });
  section.appendChild(textarea);
  return section;
}

// ─────────────────────────────────────────────────────────
// 액션 바 (저장/불러오기/엑셀/초기화)
// ─────────────────────────────────────────────────────────

function renderActionBar(): HTMLElement {
  const bar = el("div", { class: "action-bar" });

  const saveJsonBtn = el("button", { class: "btn", type: "button" }, ["내 데이터 JSON 저장"]);
  saveJsonBtn.addEventListener("click", () => {
    state.academicRecords = recordsFromQuickEntries();
    downloadJsonFile(state);
    showToast("JSON 파일을 저장했습니다. 다음 학년에도 이 파일을 불러와 이어서 사용할 수 있습니다.");
  });

  const loadJsonBtn = el("button", { class: "btn secondary", type: "button" }, ["JSON 불러오기"]);
  const fileInput = el("input", { type: "file", accept: "application/json", style: "display:none;" }) as HTMLInputElement;
  loadJsonBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const { data, wasMigrated, appliedMigrations } = parseAndMigrate(text);
      state = data;
      rebuildQuickEntriesFromState();
      const root = document.getElementById("app")!;
      mountApp(root); // 순수 렌더링만 하므로 autosave를 다시 읽지 않는다 (방금 불러온 값이 덮이지 않음)
      showToast(wasMigrated ? `데이터를 불러왔습니다 (버전 변환: ${appliedMigrations.join(", ")})` : "데이터를 불러왔습니다.");
      await autosave(state); // 불러온 값을 자동저장에도 즉시 반영
    } catch (e: any) {
      showToast(`불러오기 실패: ${e.message ?? e}`);
    }
    fileInput.value = "";
  });

  const excelBtn = el("button", { class: "btn secondary", type: "button" }, ["Excel 상담자료 생성"]);
  excelBtn.addEventListener("click", async () => {
    state.academicRecords = recordsFromQuickEntries();
    excelBtn.setAttribute("disabled", "true");
    excelBtn.textContent = "생성 중...";
    try {
      await exportToExcelFile(state);
      showToast("Excel 상담자료를 생성했습니다.");
    } catch (e: any) {
      showToast(`Excel 생성 실패: ${e.message ?? e}`);
    } finally {
      excelBtn.removeAttribute("disabled");
      excelBtn.textContent = "Excel 상담자료 생성";
    }
  });

  const resetBtn = el("button", { class: "btn danger", type: "button" }, ["초기화"]);
  resetBtn.addEventListener("click", async () => {
    if (!confirm("입력한 모든 데이터를 지웁니다. JSON으로 저장하지 않았다면 복구할 수 없습니다. 계속할까요?")) return;
    state = createEmptyDataFile();
    quickEntries = Object.fromEntries(SUBJECT_GROUPS.map((s) => [s, []]));
    preservedRecords = [];
    gradeScale = getCohortPolicy(getCurrentAcademicYear(), 3).gradeScale; // 코호트 기본값으로 재설정
    await clearAutosave();
    const root = document.getElementById("app")!;
    mountApp(root);
    showToast("초기화되었습니다.");
  });

  bar.append(saveJsonBtn, loadJsonBtn, fileInput, excelBtn, resetBtn);
  return bar;
}

// ─────────────────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────────────────

function mkField(label: string, type: string, placeholder = ""): { field: HTMLElement; input: HTMLInputElement } {
  const field = el("div", { class: "field" }, [label]);
  const input = el("input", { type, placeholder }) as HTMLInputElement;
  field.appendChild(input);
  return { field, input };
}

function numOrUndef(s: string): number | undefined {
  if (s == null || s.trim() === "") return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

function scheduleAutosave(): void {
  const indicator = document.getElementById("save-indicator");
  if (indicator) indicator.lastChild!.textContent = "저장 중...";
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    state.metadata.updatedAt = new Date().toISOString();
    await autosave(state);
    if (indicator) indicator.lastChild!.textContent = "자동저장됨";
  }, 600);
}

function showToast(msg: string): void {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  window.setTimeout(() => toastEl.classList.remove("show"), 2600);
}
