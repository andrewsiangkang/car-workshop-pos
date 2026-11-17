import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";
import { schemaReady } from "@/lib/schema-upgrade";

export const dynamic = "force-dynamic";

// 【中文】版本号；顺便确认数据库升级已完成（启动时升级失败的话，这里会再试，最多每 10 分钟一次）。
export async function GET() {
  const schemaUpToDate = await schemaReady();
  return NextResponse.json({
    version: packageJson.version,
    name: packageJson.name,
    schemaUpToDate,
  });
}
