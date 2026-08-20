import { defineConfig } from "vite";

// base: "./" — 검수 지적 반영: 기본값(절대경로 "/")으로 빌드하면 dist/index.html을
// file://로 직접 열거나 GitHub Pages의 저장소 하위 경로(예: /repo-name/)에 배포할 때
// 자산 경로를 찾지 못한다. 상대경로로 고정해 두 경우 모두 안전하게 동작하도록 한다.
export default defineConfig({
  base: "./",
});
