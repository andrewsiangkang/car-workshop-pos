/**
 * 【中文】供应商发票文字解析（纯函数，不依赖浏览器/数据库，可单独测试）。
 * OCR 识别出一堆文字后，这里尝试找出：供应商名、发票号、日期、各行商品（说明/数量/单价/金额）、税额、总额，
 * 并按关键字给每个商品分类。识别结果一定会先显示给用户核对和修改，确认后才会入库。
 */
import { money } from "@/lib/tax";

export type ParsedItem = { description: string; quantity: number; unitCost: number; total: number; category: string };
export type ParsedInvoice = {
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD or ""
  taxAmount: number;
  totalAmount: number;
  items: ParsedItem[];
};

// 【中文】分类关键字（英文 + 马来文 + 中文）。按顺序匹配，先匹配到的为准。
const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["Filters", /filter|penapis|滤芯|滤清/i],
  ["Oil & Lubricants", /\b(oil|minyak|lubricant|grease|atf|gear oil|engine oil|coolant|brake fluid|5w|10w|15w|20w)\b|机油|齿轮油|冷却液|刹车油/i],
  ["Brakes", /brake|brek|\bpad\b|rotor|caliper|刹车|碟片/i],
  ["Tyres & Wheels", /\btyre\b|\btire\b|tayar|\brim\b|wheel|轮胎|钢圈/i],
  ["Battery", /battery|bateri|电池/i],
  ["Ignition", /spark|plug|ignition|\bcoil\b|火花塞|点火/i],
  ["Suspension & Steering", /shock|absorber|suspension|\barm\b|bush|stabili[sz]er|tie rod|rack|ball joint|spring|避震|悬挂|转向/i],
  ["Engine & Cooling", /gasket|piston|timing|\bbelt\b|\bpump\b|radiator|hose|thermostat|engine mount|valve|垫|皮带|水箱|水泵|活塞/i],
  ["Electrical", /bulb|lamp|fuse|relay|sensor|alternator|starter|wiper|switch|wiring|灯|保险丝|传感器|发电机|雨刮/i],
  ["Air Conditioning", /aircond|air cond|a\/c|compressor|condenser|evaporator|冷气|压缩机/i],
  ["Body & Exterior", /bumper|mirror|fender|bonnet|grille|door|bodi|保险杠|后视镜/i],
  ["Labour / Service", /labou?r|service charge|upah|工钱|服务费/i],
];

export function categorize(description: string): string {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(description)) return cat;
  return "Others";
}

const MONEY = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g;
const toNum = (s: string) => Number(s.replace(/,/g, ""));
const SKIP_LINE =
  /\b(sub\s*-?\s*total|grand\s*total|total|sst|service tax|tax|gst|rounding|discount|balance|amount due|cash|change|paid|payment|terms|tel|fax|phone|email|www|page|invoice\s*(no|date)|date|due)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export function findDate(text: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) => y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  let m = text.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m && ok(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/); // 马来西亚习惯 日/月/年
  if (m && ok(+m[3], +m[2], +m[1])) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,4})[a-z]*\.?,?\s+(\d{4})\b/);
  if (m && MONTHS[m[2].toLowerCase()] && ok(+m[3], MONTHS[m[2].toLowerCase()], +m[1])) {
    return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`;
  }
  return "";
}

export function parseInvoiceText(raw: string): ParsedInvoice {
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join("\n");

  const supplierName =
    lines.find((l) => /[A-Za-z一-鿿]{3,}/.test(l) && !/invoice|tax|date|tel|www|@/i.test(l))?.slice(0, 120) || "";

  // 【中文】发票号：优先找“Invoice No / Inv No / Bil No”后面的内容，其次找以 INV 开头的编号。
  let invoiceNo = "";
  for (const l of lines) {
    const m = l.match(/\b(?:invoice|inv|bil)\s*(?:no\.?|number|#)\s*[:.]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})/i);
    if (m) { invoiceNo = m[1]; break; }
  }
  if (!invoiceNo) {
    const m = text.match(/\b(INV[-\/]?[A-Z0-9][A-Z0-9\-\/]+)/i);
    if (m) invoiceNo = m[1];
  }

  let totalAmount = 0;
  let taxAmount = 0;
  for (const l of lines) {
    const nums = l.match(MONEY);
    if (!nums) continue;
    const last = toNum(nums[nums.length - 1]);
    if (/(grand\s*total|total\s*(amount|payable|due)?|amount due|jumlah)/i.test(l) && !/sub\s*-?\s*total/i.test(l)) {
      totalAmount = Math.max(totalAmount, last);
    } else if (/\b(sst|service tax|tax|gst|cukai)\b/i.test(l) && !/tax\s*invoice/i.test(l)) {
      taxAmount = last;
    }
  }

  const items: ParsedItem[] = [];
  for (const l of lines) {
    if (SKIP_LINE.test(l)) continue;
    const nums = l.match(MONEY);
    if (!nums || nums.length < 2) continue;
    const total = toNum(nums[nums.length - 1]);
    const unit = toNum(nums[nums.length - 2]);
    const firstIdx = l.indexOf(nums[nums.length - 2]);
    let head = l.slice(0, firstIdx).trim();
    // 去掉行首序号，抓取数量
    head = head.replace(/^\d{1,3}[.)]?\s+/, "");
    let qty = 0;
    const q = head.match(/\s(\d+(?:\.\d+)?)\s*(?:pcs?|units?|sets?|btl|ltr?|l|x|nos?|pc)?\s*$/i);
    if (q) {
      qty = Number(q[1]);
      head = head.slice(0, q.index).trim();
    }
    if (!qty || !Number.isFinite(qty)) {
      qty = unit > 0 ? Math.round((total / unit) * 100) / 100 : 1;
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;
    }
    const description = head.replace(/[|_]+/g, " ").trim();
    if (description.length < 2 || !/[A-Za-z一-鿿]/.test(description)) continue;
    items.push({ description: description.slice(0, 200), quantity: qty, unitCost: money(unit), total: money(total), category: categorize(description) });
  }

  return { supplierName, invoiceNo, invoiceDate: findDate(text), taxAmount: money(taxAmount), totalAmount: money(totalAmount), items };
}
