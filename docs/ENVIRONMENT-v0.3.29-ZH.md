# v0.3.29 环境密钥配置

## 必需密钥

MyInvois Client Secret 现以 AES-256-GCM 加密保存。必须在运行服务的环境中配置以下任意一项：

- `MYINVOIS_ENCRYPTION_KEY`：推荐，独立加密密钥。
- `AUTH_SECRET`：备选，至少 16 字符，并且在同一安装中长期不变。

建议使用独立 `MYINVOIS_ENCRYPTION_KEY`，并将其放在安全的环境变量/安装密钥存储中。不要写入 Git、源码、截图或公开日志。

## Windows PowerShell 开发环境示例

```powershell
$env:AUTH_SECRET = "replace-with-a-long-random-install-secret"
$env:MYINVOIS_ENCRYPTION_KEY = "replace-with-a-different-long-random-encryption-key"
npm run dev
```

## Electron

Electron 主进程已为每台安装生成并持久保存 `AUTH_SECRET`。若需要独立加密密钥，可在启动 Electron 服务的环境中设置 `MYINVOIS_ENCRYPTION_KEY`。

## 重要

- 密钥遗失或更换后，已加密的 MyInvois Client Secret 将无法解密。
- 更换密钥前必须先备份数据库，并按密钥轮换流程重新加密。
- 不要把真实密钥提交到 GitHub。
- 旧版数据库中的明文 Client Secret 会在首次成功读取 MyInvois 配置时迁移为加密格式。
