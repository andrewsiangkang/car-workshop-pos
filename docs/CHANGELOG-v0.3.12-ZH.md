# Car Workshop POS v0.3.12 更新说明

## 老板自定义单据外观
- Settings → Document Templates 新增 Workshop Logo 上传（PNG/JPG/WEBP，最大 2MB），仅老板可操作。
- Logo 可选择左、中、右对齐，并选择 80/120/160/200px 宽度。
- 可选择单据字体大小：小、正常、大。
- 可分别控制店铺地址、电话、电邮、TIN/BRN/SST、单据编号、工单编号、日期、项目数量、单价及付款 QR 显示。
- 设置保存于 ShopProfile；打印 Quotation / Invoice / Receipt 时读取同一配置。
- Receipt 默认继续使用 A5 Landscape；可保留之前的 A5 Portrait 选项。
- 上传文件名由服务器生成，图片类型及真实文件签名由现有上传 API 检查；文件不接受外部任意 URL。

## 兼容性
- 沿用现有 ShopProfile.logoUrl 与 documentSettings 字段，不新增数据库列，不需要破坏性迁移。
- 旧设置缺少新字段时使用默认显示行为，保持旧单据原样可用。

## 验证
- 已对本次修改的 TS/TSX 文件执行 TypeScript transpile 语法检查。
- 已执行项目 Node 测试套件。
- 当前工作环境没有安装项目 node_modules；完整 Next.js typecheck / production build 仍须在用户 Windows/GitHub Actions 环境验证。
