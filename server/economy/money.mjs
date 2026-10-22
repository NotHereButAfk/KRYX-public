// Four decimal fixed-point units. Currency never crosses a Number boundary in storage.
export const SCALE = 10000n;
export function units(value) {
  const s = String(value);
  if (!/^-?\d{1,14}(\.\d{1,4})?$/.test(s))
    throw new Error("Expected decimal with at most four places");
  const negative = s.startsWith("-");
  const [whole, fraction = ""] = s.replace("-", "").split(".");
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, "0")))
  );
}
export function decimal(value) {
  const sign = value < 0n ? "-" : "",
    n = value < 0n ? -value : value;
  return `${sign}${n / SCALE}.${String(n % SCALE).padStart(4, "0")}`;
}
export const mul = (a, b) => (a * b) / SCALE;
export const min = (a, b) => (a < b ? a : b);
export const max = (a, b) => (a > b ? a : b);
