import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Find a customer by the matching phone (see customerPhoneKey). Older records may have
 * been saved with spaces / hyphens / brackets / dots ("012-345 6789"), so the stored phone
 * is normalised the same way inside SQLite. The oldest match wins, so the result is stable.
 * An empty key (no phone / placeholder) never matches anyone.
 */
// 【中文】按电话找客户：数据库里旧记录可能带空格、横线等，这里在 SQLite 里同样去掉再比对；空电话（含 N/A）永远不配对。
export async function findCustomerByPhone(db: Db, phoneKey: string) {
  if (!phoneKey) return null;
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Customer"
    WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM("phone"), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), char(9), ''), char(160), '') = ${phoneKey}
    ORDER BY "createdAt" ASC
    LIMIT 1`;
  if (!rows.length) return null;
  return db.customer.findUnique({ where: { id: rows[0].id } });
}
