/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Record each request's real socket address before Next.js handles it (audit log, login
    // origin): X-Forwarded-For can be typed by any client. 【中文】记录每个请求的真实连接地址（审计日志、登录来源判断）。
    const { installPeerStamp } = await import("@/lib/privacy-peer");
    await installPeerStamp().catch((e) => console.error("[peer] could not record request addresses", e));
    const { ensureSchema } = await import("@/lib/schema-upgrade");
    // Upgrade an older shop database (adds new columns such as SST) before any request.
    await ensureSchema().catch(() => {});
    // Then (desktop app): seal a plain MyInvois secret from an older version, and record a
    // backup restore in the audit log of the database that is now live (and retire the document
    // numbers the restore rolled back, so they are never issued twice).
    // 【中文】然后：把旧版本的明文密钥改为加密保存；把刚才的「还原备份」写进审计日志，并停用被还原掉的单据号码（不会重复开出）。
    const { sealPlainSecrets, recordRestoreAudit, clearExpiredBuyerDataAtStart } = await import("@/lib/desktop-startup");
    await sealPlainSecrets().catch((e) => console.error("[secret-box] could not seal the stored secret", e));
    await recordRestoreAudit().catch((e) => console.error("[restore-audit]", e));
    // Anonymised customers' documents that have passed the record-keeping period lose their buyer
    // data (PDPA). In the background: the server answers requests without waiting for it (each
    // customer is its own transaction, so stopping the server half-way loses nothing).
    // 【中文】已匿名客户的单据过了保存期后，清除买方资料。在后台进行，服务器不用等它完成就开始服务（每位客户一个交易，中途关闭也不会出错）。
    void clearExpiredBuyerDataAtStart().catch((e) => console.error("[privacy] could not clear expired buyer data", e));
  }
}
