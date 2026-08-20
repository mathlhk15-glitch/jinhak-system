// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 검수에서 지적된 P0 버그 회귀 테스트:
 * 이전 구현은 mountApp() 마지막에 restoreAutosave()를 호출하고, 복구 성공 시
 * restoreAutosave()가 다시 mountApp()을 호출해 IndexedDB에 저장된 데이터가 있는 한
 * 무한 재귀에 빠졌다. bootstrapApp()은 시작 시 단 한 번만 자동저장을 읽고,
 * mountApp()은 이후 순수 렌더링만 해야 한다.
 *
 * indexedDb 모듈을 통째로 모킹해서 loadAutosave가 실제로 몇 번 호출되는지 센다.
 * (모듈 내부에서 로컬 바인딩으로 호출되므로, vi.mock으로 모듈 자체를 치환해야
 * 스파이가 실제로 걸린다 — 외부에서 만든 별도 vi.fn 래퍼는 훅되지 않는다.)
 */

const loadAutosaveMock = vi.fn();
const autosaveMock = vi.fn();
const clearAutosaveMock = vi.fn();

vi.mock("../src/storage/indexedDb", () => ({
  loadAutosave: loadAutosaveMock,
  autosave: autosaveMock,
  clearAutosave: clearAutosaveMock,
}));

describe("bootstrapApp / mountApp — 자동저장 복구는 시작 시 1회만", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    loadAutosaveMock.mockReset();
    autosaveMock.mockReset();
    clearAutosaveMock.mockReset();
  });

  it("자동저장 데이터가 있어도 loadAutosave는 정확히 1회만 호출된다 (재귀 없음)", async () => {
    const { createEmptyDataFile } = await import("../src/models/academic");
    const savedData = createEmptyDataFile();
    savedData.profile = { name: "회귀테스트" };
    loadAutosaveMock.mockResolvedValue(savedData);

    const { bootstrapApp } = await import("../src/ui/grade3QuickMode");

    const root = document.createElement("div");
    document.body.appendChild(root);

    await bootstrapApp(root);

    // 핵심 검증: 이전 버그였다면 mountApp이 반복 호출될 때마다 loadAutosave도
    // 계속 호출되어 이 값이 1보다 훨씬 커지거나(또는 스택오버플로우로 테스트가 죽는다).
    expect(loadAutosaveMock).toHaveBeenCalledTimes(1);

    const nameInput = root.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput?.value).toBe("회귀테스트");
  });

  it("mountApp을 이후에 여러 번 직접 호출해도 loadAutosave 호출 횟수가 늘어나지 않는다", async () => {
    loadAutosaveMock.mockResolvedValue(null);

    const { bootstrapApp, mountApp } = await import("../src/ui/grade3QuickMode");
    const root = document.createElement("div");
    document.body.appendChild(root);

    await bootstrapApp(root);
    expect(loadAutosaveMock).toHaveBeenCalledTimes(1);

    mountApp(root);
    mountApp(root);
    mountApp(root);

    // mountApp은 순수 렌더링 함수이므로 몇 번을 호출해도 loadAutosave 호출 수는 그대로다.
    expect(loadAutosaveMock).toHaveBeenCalledTimes(1);
  });

  it("자동저장 데이터가 없을 때도 정상적으로 1회 렌더링된다", async () => {
    loadAutosaveMock.mockResolvedValue(null);
    const { bootstrapApp } = await import("../src/ui/grade3QuickMode");
    const root = document.createElement("div");
    document.body.appendChild(root);

    await bootstrapApp(root);
    expect(loadAutosaveMock).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".masthead")).toBeTruthy();
  });
});
