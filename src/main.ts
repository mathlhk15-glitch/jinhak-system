import { bootstrapApp } from "./ui/grade3QuickMode";

const root = document.getElementById("app");
if (!root) {
  throw new Error("#app 요소를 찾을 수 없습니다.");
}
// 자동저장 복구는 여기서 앱 시작 시 딱 한 번만 수행한다 (mountApp 내부에서 재귀 호출하지 않음).
void bootstrapApp(root);
