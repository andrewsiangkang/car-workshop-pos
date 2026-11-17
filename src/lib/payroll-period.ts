/** Malaysia-local payroll month boundaries represented as UTC instants. */
const MALAYSIA_UTC_OFFSET_MINUTES = 8 * 60;

export function malaysiaPayrollMonthRange(periodKey: string): { startAt: Date; endAt: Date } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) {
    throw new Error("Payroll period must use YYYY-MM format");
  }
  const [year, month] = periodKey.split("-").map(Number);
  const offsetMs = MALAYSIA_UTC_OFFSET_MINUTES * 60 * 1000;
  return {
    startAt: new Date(Date.UTC(year, month - 1, 1) - offsetMs),
    endAt: new Date(Date.UTC(year, month, 1) - offsetMs),
  };
}
