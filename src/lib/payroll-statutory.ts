/**
 * Malaysia payroll calculation helpers.
 *
 * Rules are versioned against the official schedules linked in docs/PAYROLL-v0.5.4-ZH.md.
 * EPF / SOCSO / EIS are calculation previews using the published contribution rates and
 * statutory rounding conventions. Because the statutory schedules are banded and worker
 * classifications can have exceptions, every generated result is flagged for owner review
 * against the official portals before payroll approval.
 */
export type PayrollStatutoryProfile = {
  statutoryProfileComplete: boolean;
  epfCategory: "MALAYSIAN_UNDER_60" | "MALAYSIAN_60_PLUS" | "PR_UNDER_60" | "PR_60_PLUS" | "FOREIGN" | "NONE";
  socsoCategory: "FIRST" | "SECOND" | "FOREIGN" | "NONE";
  socsoSkbbk: "ON" | "OFF";
  eisEligible: boolean;
  taxResidency: "RESIDENT" | "NON_RESIDENT";
  taxCategory: "SINGLE" | "MARRIED_SPOUSE_NOT_WORKING" | "MARRIED_SPOUSE_WORKING";
  qualifyingChildren: number;
  disabledSelf: boolean;
  disabledSpouse: boolean;
  priorGrossYtd: number;
  priorEpfYtd: number;
  priorPcbYtd: number;
  priorZakatYtd: number;
  priorSocsoYtd: number;
  taxReliefYtd: number;
  taxReliefMonthly: number;
  zakatMonthly: number;
};

export type StatutoryResult = {
  epfEmployee: number;
  epfEmployer: number;
  socsoEmployee: number;
  socsoEmployer: number;
  eisEmployee: number;
  eisEmployer: number;
  pcb: number;
  grossWages: number;
  calculationVersion: string;
  calculatedAt: string;
  warnings: string[];
  breakdown: Record<string, number | string | boolean>;
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const ceilRinggit = (value: number) => Math.ceil(value - 1e-9);
const nearestFiveCents = (value: number) => Math.ceil((value - 1e-9) * 20) / 20;
const truncate2 = (value: number) => Math.trunc((value + 1e-9) * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function epfRates(category: PayrollStatutoryProfile["epfCategory"], wages: number) {
  switch (category) {
    case "MALAYSIAN_UNDER_60": return { employee: 11, employer: wages <= 5000 ? 13 : 12 };
    case "PR_UNDER_60": return { employee: 11, employer: wages <= 5000 ? 13 : 12 };
    case "MALAYSIAN_60_PLUS": return { employee: 0, employer: 4 };
    case "PR_60_PLUS": return { employee: 5.5, employer: 6 };
    case "FOREIGN": return { employee: 2, employer: 2 };
    default: return { employee: 0, employer: 0 };
  }
}

function calcEpf(wages: number, category: PayrollStatutoryProfile["epfCategory"]) {
  const cappedWages = Math.max(0, wages);
  const rates = epfRates(category, cappedWages);
  // KWSP Third Schedule (effective 1 Oct 2025): Part A uses RM20 bands up to RM5,000
  // and RM100 bands from RM5,000.01 to RM20,000; Parts C/E use the same wage-band widths.
  // Contributions within a band are calculated against that band's upper wage limit.
  const bandedCategory = category !== "FOREIGN";
  const rateBase = cappedWages > 20000 || !bandedCategory
    ? cappedWages
    : cappedWages <= 5000
      ? Math.ceil(cappedWages / 20) * 20
      : Math.ceil(cappedWages / 100) * 100;
  const noContributionFloor = bandedCategory && cappedWages <= 10;
  const employee = noContributionFloor ? 0 : rateBase > 20000 ? cents(rateBase * rates.employee / 100) : ceilRinggit(rateBase * rates.employee / 100);
  const employer = noContributionFloor ? 0 : rateBase > 20000 ? cents(rateBase * rates.employer / 100) : ceilRinggit(rateBase * rates.employer / 100);
  return { employee, employer, rates, rateBase: cents(rateBase) };
}

// PERKESO Act 4 contribution table, First / Second Category, Phase 1 SKBBK
// effective 1 June 2026. Columns: upper wage, first employer, employee invalidity,
// employee SKBBK, second employer. The final wage band is capped at RM6,000.
const PERKESO_ACT4_TABLE: Array<[number, number, number, number, number]> = [
  [30, 0.40, 0.10, 0.20, 0.30],
  [50, 0.70, 0.20, 0.30, 0.50],
  [70, 1.10, 0.30, 0.50, 0.80],
  [100, 1.50, 0.40, 0.65, 1.10],
  [140, 2.10, 0.60, 0.90, 1.50],
  [200, 2.95, 0.85, 1.25, 2.10],
  [300, 4.35, 1.25, 1.85, 3.10],
  [400, 6.15, 1.75, 2.65, 4.40],
  [500, 7.85, 2.25, 3.35, 5.60],
  [600, 9.65, 2.75, 4.15, 6.90],
  [700, 11.35, 3.25, 4.85, 8.10],
  [800, 13.15, 3.75, 5.65, 9.40],
  [900, 14.85, 4.25, 6.35, 10.60],
  [1000, 16.65, 4.75, 7.15, 11.90],
  [1100, 18.35, 5.25, 7.85, 13.10],
  [1200, 20.15, 5.75, 8.65, 14.40],
  [1300, 21.85, 6.25, 9.35, 15.60],
  [1400, 23.65, 6.75, 10.15, 16.90],
  [1500, 25.35, 7.25, 10.85, 18.10],
  [1600, 27.15, 7.75, 11.65, 19.40],
  [1700, 28.85, 8.25, 12.35, 20.60],
  [1800, 30.65, 8.75, 13.15, 21.90],
  [1900, 32.35, 9.25, 13.85, 23.10],
  [2000, 34.15, 9.75, 14.65, 24.40],
  [2100, 35.85, 10.25, 15.35, 25.60],
  [2200, 37.65, 10.75, 16.15, 26.90],
  [2300, 39.35, 11.25, 16.85, 28.10],
  [2400, 41.15, 11.75, 17.65, 29.40],
  [2500, 42.85, 12.25, 18.35, 30.60],
  [2600, 44.65, 12.75, 19.15, 31.90],
  [2700, 46.35, 13.25, 19.85, 33.10],
  [2800, 48.15, 13.75, 20.65, 34.40],
  [2900, 49.85, 14.25, 21.35, 35.60],
  [3000, 51.65, 14.75, 22.15, 36.90],
  [3100, 53.35, 15.25, 22.85, 38.10],
  [3200, 55.15, 15.75, 23.65, 39.40],
  [3300, 56.85, 16.25, 24.35, 40.60],
  [3400, 58.65, 16.75, 25.15, 41.90],
  [3500, 60.35, 17.25, 25.85, 43.10],
  [3600, 62.15, 17.75, 26.65, 44.40],
  [3700, 63.85, 18.25, 27.35, 45.60],
  [3800, 65.65, 18.75, 28.15, 46.90],
  [3900, 67.35, 19.25, 28.85, 48.10],
  [4000, 69.15, 19.75, 29.65, 49.40],
  [4100, 70.85, 20.25, 30.35, 50.60],
  [4200, 72.65, 20.75, 31.15, 51.90],
  [4300, 74.35, 21.25, 31.85, 53.10],
  [4400, 76.15, 21.75, 32.65, 54.40],
  [4500, 77.85, 22.25, 33.35, 55.60],
  [4600, 79.65, 22.75, 34.15, 56.90],
  [4700, 81.35, 23.25, 34.85, 58.10],
  [4800, 83.15, 23.75, 35.65, 59.40],
  [4900, 84.85, 24.25, 36.35, 60.60],
  [5000, 86.65, 24.75, 37.15, 61.90],
  [5100, 88.35, 25.25, 37.85, 63.10],
  [5200, 90.15, 25.75, 38.65, 64.40],
  [5300, 91.85, 26.25, 39.35, 65.60],
  [5400, 93.65, 26.75, 40.15, 66.90],
  [5500, 95.35, 27.25, 40.85, 68.10],
  [5600, 97.15, 27.75, 41.65, 69.40],
  [5700, 98.85, 28.25, 42.35, 70.60],
  [5800, 100.65, 28.75, 43.15, 71.90],
  [5900, 102.35, 29.25, 43.85, 73.10],
  [6000, 104.15, 29.75, 44.65, 74.40],
];

function perkesoBand(wages: number) {
  const capped = clamp(wages, 0, 6000);
  const index = PERKESO_ACT4_TABLE.findIndex(([upper]) => capped <= upper);
  const rowIndex = index < 0 ? PERKESO_ACT4_TABLE.length - 1 : index;
  const row = PERKESO_ACT4_TABLE[rowIndex];
  const lower = rowIndex === 0 ? 0 : PERKESO_ACT4_TABLE[rowIndex - 1][0];
  return { row, lower, upper: row[0], midpoint: (lower + row[0]) / 2, rowIndex: rowIndex + 1, cappedWages: cents(capped) };
}

function skbbkRateForPeriod(periodKey: string) {
  const year = Number(periodKey.slice(0, 4));
  const month = Number(periodKey.slice(5));
  const monthIndex = year * 12 + month;
  if (monthIndex >= 2031 * 12 + 6) return 1.25;
  if (monthIndex >= 2028 * 12 + 6) return 1.0;
  return 0.75;
}

function calcSocso(wages: number, category: PayrollStatutoryProfile["socsoCategory"], skbbk: "ON" | "OFF", epfCategory: PayrollStatutoryProfile["epfCategory"], periodKey: string) {
  const band = perkesoBand(wages);
  if (category === "NONE" || band.cappedWages <= 0) return { employee: 0, employer: 0, employeeInvalidity: 0, skbbkEmployee: 0, band };
  const foreign = category === "FOREIGN" || epfCategory === "FOREIGN";
  const first = category === "FIRST" || category === "FOREIGN";
  const firstEmployer = band.row[1];
  const invalidityEmployee = band.row[2];
  const phase1Skbbk = band.row[3];
  const secondEmployer = band.row[4];
  const phase = skbbkRateForPeriod(periodKey);
  const skbbkEmployee = foreign || skbbk === "ON"
    ? (phase === 0.75 ? phase1Skbbk : nearestFiveCents(band.midpoint * phase / 100))
    : 0;
  const employeeInvalidity = first ? invalidityEmployee : 0;
  const employer = first ? firstEmployer : secondEmployer;
  return { employee: cents(employeeInvalidity + skbbkEmployee), employer, employeeInvalidity, skbbkEmployee, band, phase };
}

function calcEis(wages: number, eligible: boolean) {
  const band = perkesoBand(wages);
  const share = eligible && band.cappedWages > 0 ? nearestFiveCents(band.midpoint * 0.2 / 100) : 0;
  return { employee: share, employer: share, rate: eligible ? 0.2 : 0, wageBase: band.cappedWages, band };
}

const PCB_BRACKETS = [
  { min: 5000, rate: 1, m: 5000, b13: -400, b2: -800 },
  { min: 20000, rate: 3, m: 20000, b13: -250, b2: -650 },
  { min: 35000, rate: 6, m: 35000, b13: 600, b2: 600 },
  { min: 50000, rate: 11, m: 50000, b13: 1500, b2: 1500 },
  { min: 70000, rate: 19, m: 70000, b13: 3700, b2: 3700 },
  { min: 100000, rate: 25, m: 100000, b13: 9400, b2: 9400 },
  { min: 400000, rate: 26, m: 400000, b13: 84400, b2: 84400 },
  { min: 600000, rate: 28, m: 600000, b13: 136400, b2: 136400 },
  { min: 2000000, rate: 30, m: 2000000, b13: 528400, b2: 528400 },
];

function calcPcb2026(wages: number, epfEmployee: number, socsoEmployee: number, periodKey: string, profile: PayrollStatutoryProfile) {
  if (profile.taxResidency === "NON_RESIDENT") {
    const raw = truncate2(Math.max(0, wages) * 0.3);
    return { amount: raw < 10 ? 0 : nearestFiveCents(raw), chargeableIncome: null, method: "NON_RESIDENT_30_PERCENT" };
  }
  const month = Number(periodKey.slice(5));
  const remainingMonths = Math.max(0, 12 - month);
  const priorGross = Math.max(0, profile.priorGrossYtd);
  const priorEpf = clamp(profile.priorEpfYtd, 0, 4000);
  const currentEpf = Math.min(Math.max(0, epfEmployee), Math.max(0, 4000 - priorEpf));
  const futureEpf = remainingMonths > 0
    ? Math.min(currentEpf, Math.max(0, (4000 - priorEpf - currentEpf) / remainingMonths))
    : 0;
  const personal = 9000;
  const spouse = profile.taxCategory === "MARRIED_SPOUSE_NOT_WORKING" ? 4000 : 0;
  const disabledSelf = profile.disabledSelf ? 7000 : 0;
  const disabledSpouse = profile.disabledSpouse ? 6000 : 0;
  const children = Math.max(0, Math.floor(profile.qualifyingChildren)) * 2000;
  const socsoRelief = Math.min(350, Math.max(0, profile.priorSocsoYtd) + Math.max(0, socsoEmployee));
  const otherRelief = Math.max(0, profile.taxReliefYtd) + Math.max(0, profile.taxReliefMonthly);
  const chargeable = Math.max(0,
    (priorGross - priorEpf)
    + (wages - currentEpf)
    + remainingMonths * (wages - futureEpf)
    - personal - spouse - disabledSelf - disabledSpouse - children - socsoRelief - otherRelief,
  );
  if (chargeable <= 5000) return { amount: 0, chargeableIncome: cents(chargeable), method: "RESIDENT_2026_MTD" };
  const bracket = [...PCB_BRACKETS].reverse().find((row) => chargeable > row.min) || PCB_BRACKETS[0];
  const category2 = profile.taxCategory === "MARRIED_SPOUSE_NOT_WORKING";
  const annualizedTax = (chargeable - bracket.m) * bracket.rate / 100 + (category2 ? bracket.b2 : bracket.b13);
  const priorPcb = Math.max(0, profile.priorPcbYtd);
  const priorZakat = Math.max(0, profile.priorZakatYtd);
  const currentMtd = Math.max(0, truncate2((annualizedTax - priorPcb - priorZakat) / (remainingMonths + 1)));
  const beforeZakat = currentMtd < 10 ? 0 : currentMtd;
  const afterZakat = Math.max(0, beforeZakat - Math.max(0, profile.zakatMonthly));
  return { amount: afterZakat > 0 ? nearestFiveCents(afterZakat) : 0, chargeableIncome: cents(chargeable), method: "RESIDENT_2026_MTD" };
}

export function calculateMalaysiaStatutory(input: {
  grossWages: number;
  periodKey: string;
  profile: PayrollStatutoryProfile;
}): StatutoryResult | null {
  const { grossWages, periodKey, profile } = input;
  if (!profile.statutoryProfileComplete || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey) || periodKey < "2026-06" || !Number.isFinite(grossWages) || grossWages < 0) return null;
  const epf = calcEpf(grossWages, profile.epfCategory);
  const socso = calcSocso(grossWages, profile.socsoCategory, profile.socsoSkbbk, profile.epfCategory, periodKey);
  const eisEligible = profile.eisEligible && !["FOREIGN", "MALAYSIAN_60_PLUS", "PR_60_PLUS"].includes(profile.epfCategory);
  const eis = calcEis(grossWages, eisEligible);
  const pcb = calcPcb2026(grossWages, epf.employee, socso.employee, periodKey, profile);
  const warnings = [
    "EPF uses the KWSP Third Schedule category rates and wage-band upper limits; confirm special cases and combined contribution rounding before remittance.",
    "SOCSO / SKBBK uses the official PERKESO Phase 1 wage-band table; confirm category, local opt-in / opt-out and later phase rates before remittance.",
    "PCB is calculated for ordinary monthly remuneration using HASiL 2026 MTD rules. Non-monthly bonus / arrears require the additional-remuneration formula.",
  ];
  return {
    epfEmployee: cents(epf.employee), epfEmployer: cents(epf.employer),
    socsoEmployee: cents(socso.employee), socsoEmployer: cents(socso.employer),
    eisEmployee: cents(eis.employee), eisEmployer: cents(eis.employer),
    pcb: cents(pcb.amount), grossWages: cents(grossWages),
    calculationVersion: "MY-2026-REVIEW-1",
    calculatedAt: new Date().toISOString(),
    warnings,
    breakdown: {
      epfCategory: profile.epfCategory, epfEmployeeRate: epf.rates.employee, epfEmployerRate: epf.rates.employer, epfRateBase: epf.rateBase,
      socsoCategory: profile.socsoCategory, socsoBand: socso.band.rowIndex, socsoBandLower: socso.band.lower, socsoBandUpper: socso.band.upper,
      socsoEmployeeInvalidity: socso.employeeInvalidity, skbbkEmployee: socso.skbbkEmployee, skbbkPhaseRate: socso.phase ?? 0,
      eisRate: eis.rate, eisWageBase: eis.wageBase, eisBand: eis.band.rowIndex, pcbMethod: pcb.method, pcbChargeableIncome: pcb.chargeableIncome ?? "N/A",
    },
  };
}
