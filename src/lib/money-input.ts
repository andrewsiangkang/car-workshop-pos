/** For money text boxes typed by hand: keep digits and one dot, at most 2 decimals. */
export function cleanMoneyInput(v: string) {
  let s = v.replace(/[^0-9.]/g, "");
  const i = s.indexOf(".");
  if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "").slice(0, 2);
  return s;
}
