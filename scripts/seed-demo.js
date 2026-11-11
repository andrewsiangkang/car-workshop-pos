// 【中文】演示版专用：往「空白模板数据库」里写入示范资料（假客户、假车辆、假工单）。
// 只在 GitHub 打包「演示版」时运行；正式版不会执行这个文件，所以正式版数据库永远是空的。
// 用法：DATABASE_URL=file:./template.db node scripts/seed-demo.js
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const DAY = 24 * 60 * 60 * 1000;
const ago = (d, h = 10) => new Date(Date.now() - d * DAY + (h - 12) * 3600 * 1000);
const money = (n) => Math.round(n * 100 + Number.EPSILON) / 100;

// 【中文】演示店铺登记了 SST（8%，只对工钱收税），让你能看到税额显示。
const SST_RATE = 8;
const SST_SCOPE = "LABOR";

function totals(items, discount = 0) {
  const parts = money(items.filter((i) => i.type !== "LABOR").reduce((s, i) => s + i.total, 0));
  const labor = money(items.filter((i) => i.type === "LABOR").reduce((s, i) => s + i.total, 0));
  const net = money(parts + labor - discount);
  // 演示数据：折扣简单算在工钱/零件总额上，税只按工钱（扣折扣后的比例）计
  const gross = parts + labor;
  const laborNet = gross > 0 ? money(labor - (discount * labor) / gross) : 0;
  const tax = money((laborNet * SST_RATE) / 100);
  return { partsAmount: parts, laborAmount: labor, discount, taxAmount: tax, totalAmount: money(net + tax) };
}

async function main(prisma) {
  const ownerHash = await bcrypt.hash("demo12345", 10);
  const staffHash = await bcrypt.hash("staff12345", 10);
  const owner = await prisma.user.create({
    data: { name: "示范老板", email: "demo", passwordHash: ownerHash, role: "OWNER" },
  });
  const staff = await prisma.user.create({
    data: { name: "示范员工", email: "staff", passwordHash: staffHash, role: "STAFF" },
  });

  await prisma.shopProfile.create({
    data: {
      name: "演示汽车维修中心",
      nameMs: "Pusat Servis Kereta Demo",
      address: "12, Jalan Demo 1/1, Taman Contoh",
      city: "Kuala Lumpur",
      postcode: "50450",
      stateCode: "14",
      phone: "03-1234 5678",
      email: "demo@example.com",
      tin: "C0000000000",
      brn: "202001000001",
      sstNumber: "W10-0000-00000001",
      sstRate: SST_RATE,
      sstScope: SST_SCOPE,
      msicCode: "45201",
      msicDesc: "Maintenance and repair of motor vehicles",
      myInvoisSandbox: true,
      bankName: "示范银行",
      bankAccount: "1234567890",
      receiptFooter: "谢谢惠顾！这是演示数据。",
    },
  });

  // ---- 库存 ----
  const inv = {};
  for (const x of [
    ["机油 5W-30 (4L)", "OIL-5W30", "油类", "桶", 24, 95, 150, 5],
    ["机油滤芯", "FLT-OIL", "滤芯", "pcs", 30, 12, 25, 8],
    ["空气滤芯", "FLT-AIR", "滤芯", "pcs", 12, 18, 40, 5],
    ["前刹车片", "BRK-FR", "刹车", "套", 3, 85, 160, 4], // 低库存示范
    ["火花塞", "SPK-01", "点火", "pcs", 40, 15, 32, 10],
    ["雨刮片", "WPR-01", "其他", "pcs", 15, 14, 30, 5],
  ]) {
    inv[x[1]] = await prisma.inventoryItem.create({
      data: { name: x[0], sku: x[1], category: x[2], unit: x[3], quantityOnHand: x[4], costPrice: x[5], sellingPrice: x[6], minStockLevel: x[7] },
    });
  }

  // ---- 客户 + 车辆 ----
  const people = [
    ["陈大文", "012-3456789", "WXY 1234", "Perodua", "Myvi", 2019, 56000],
    ["Ahmad bin Ali", "013-8889999", "VAB 5678", "Proton", "X50", 2021, 32000],
    ["李美玲", "016-2223333", "BQR 8899", "Toyota", "Vios", 2018, 98000],
    ["Kumar a/l Raj", "017-5556666", "JKL 2468", "Honda", "City", 2020, 61000],
  ];
  const cars = [];
  for (const p of people) {
    const c = await prisma.customer.create({ data: { name: p[0], phone: p[1] } });
    const v = await prisma.vehicle.create({
      data: { plateNumber: p[2], make: p[3], model: p[4], year: p[5], mileage: p[6], customerId: c.id },
    });
    cars.push({ c, v });
  }

  // ---- 工单 ----
  let seq = 0;
  async function order({ who, status, daysAgo, desc, items, discount = 0, paid = 0, invoiced = false, method = "CASH" }) {
    seq += 1;
    const base = ago(daysAgo);
    const ymd = new Date(base.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
    const n = String(seq).padStart(3, "0");
    const t = totals(items, discount);
    const o = await prisma.workOrder.create({
      data: {
        orderNumber: `WO${ymd}${n}`,
        quotationNumber: status !== "DRAFT" ? `QT${ymd}${n}` : null,
        invoiceNumber: invoiced ? `INV${ymd}${n}` : null,
        receiptNumber: paid > 0 ? `RC${ymd}${n}` : null,
        status,
        description: desc,
        ...t,
        taxRate: SST_RATE,
        taxScope: SST_SCOPE,
        paidAmount: paid,
        createdAt: base,
        quotedAt: status !== "DRAFT" ? base : null,
        confirmedAt: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(status) ? base : null,
        completedAt: status === "COMPLETED" ? base : null,
        invoicedAt: invoiced ? base : null,
        paidAt: paid > 0 ? base : null,
        customerId: who.c.id,
        vehicleId: who.v.id,
        createdById: owner.id,
        assignedToId: staff.id,
      },
    });
    for (const it of items) {
      await prisma.workOrderItem.create({
        data: {
          type: it.type,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          costPrice: it.costPrice || 0,
          total: it.total,
          workOrderId: o.id,
          inventoryItemId: it.inv ? inv[it.inv].id : null,
        },
      });
    }
    if (paid > 0) {
      await prisma.payment.create({ data: { amount: paid, method, workOrderId: o.id, paidAt: base } });
    }
    return o;
  }
  const part = (code, qty) => {
    const i = inv[code];
    return { type: "PART", description: i.name, quantity: qty, unitPrice: i.sellingPrice, costPrice: i.costPrice, total: money(qty * i.sellingPrice), inv: code };
  };
  const labor = (d, amt) => ({ type: "LABOR", description: d, quantity: 1, unitPrice: amt, total: amt });

  // 1) 已完成 + 已开发票 + 已付清
  const a = [part("OIL-5W30", 1), part("FLT-OIL", 1), labor("换机油工钱", 40)];
  const t1 = totals(a);
  await order({ who: cars[0], status: "COMPLETED", daysAgo: 6, desc: "定期保养", items: a, invoiced: true, paid: t1.totalAmount });
  // 2) 已完成 + 已开发票 + 部分付款
  const b = [part("BRK-FR", 1), labor("更换前刹车片", 120)];
  const t2 = totals(b, 20);
  await order({ who: cars[1], status: "COMPLETED", daysAgo: 3, desc: "刹车有异响", items: b, discount: 20, invoiced: true, paid: 200, method: "TNG" });
  // 3) 进行中
  await order({ who: cars[2], status: "IN_PROGRESS", daysAgo: 1, desc: "冷气不冷，检查", items: [labor("检查冷气系统", 80), part("FLT-AIR", 1)] });
  // 4) 已报价，等客户确认
  await order({ who: cars[3], status: "QUOTED", daysAgo: 0, desc: "换火花塞、雨刮片", items: [part("SPK-01", 4), part("WPR-01", 2), labor("更换工钱", 60)] });
  // 5) 草稿
  await order({ who: cars[0], status: "DRAFT", daysAgo: 0, desc: "待检查：引擎灯亮", items: [] });

  for (const [title, amount, category, d] of [
    ["店铺租金", 1800, "租金", 10],
    ["电费", 320, "水电", 8],
    ["进货：机油一批", 950, "进货", 5],
  ]) {
    await prisma.expense.create({ data: { title, amount, category, expenseDate: ago(d) } });
  }
  void t2;
  console.log("演示数据已写入。登录：demo / demo12345（老板），staff / staff12345（员工）");
}

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
module.exports = { main };
