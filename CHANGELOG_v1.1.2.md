# v1.1.2 변경사항

## GitHub Actions typecheck 오류 수정
- `src/engines/semesterAnalysis.ts`의 학기별 결과 배열에 `SemesterCombinationResult[]` 타입을 명시했습니다.
- TypeScript가 `COUNSELING_SEMESTERS.map()` 결과의 `semester`를 `SemesterDef`로만 추론하면서, 전체 집계 행의 `semester: null`을 거부하던 `TS2322` 오류를 해결했습니다.

## 기존 기능 유지
- 학생부 PDF 업로드/드래그앤드롭 및 자동 성적 추출
- 성적표 이미지 업로드 및 Ctrl+V 붙여넣기 OCR
- 추출 결과 검토/수정 후 성적 원자료 반영
- 국영수 / 국영수사 / 국영수과 / 국영수사과 / 전교과 단위수 가중평균
- 1학년 1학기 / 1학년 2학기 / 2학년 1학기 / 2학년 2학기 / 3학년 1학기 / 전체 분석
