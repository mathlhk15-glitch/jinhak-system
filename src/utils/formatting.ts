export function nowLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

export function safeNumber(input: string): number | undefined {
  if (input.trim() === "") return undefined;
  const n = Number(input);
  return isNaN(n) ? undefined : n;
}
