/** Runs once when the Next.js server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchema } = await import("@/lib/schema-upgrade");
    // Upgrade an older shop database (adds new columns such as SST) before any request.
    await ensureSchema().catch(() => {});
  }
}
