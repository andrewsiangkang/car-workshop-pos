// Token the desktop app sends to the embedded server's /api/internal/* routes.
// Same format as src/lib/internal-auth.mjs (checked there): "<ms timestamp>.<HMAC-SHA256 hex>".
// 【中文】桌面程序调用内部接口时附带的签名凭证（格式必须与 src/lib/internal-auth.mjs 一致）。
const crypto = require("crypto");

const INTERNAL_HEADER = "x-workshop-internal";
const LABEL = "workshop-internal-v1|";

function makeInternalToken(secret, now = Date.now()) {
  const ts = String(Math.floor(now));
  return ts + "." + crypto.createHmac("sha256", secret).update(LABEL + ts).digest("hex");
}

module.exports = { INTERNAL_HEADER, makeInternalToken };
