---
description: 保存代码到 Git 仓库
---

## 文件包含规则

| 文件类型 | 是否上传 | 说明 |
|---|---|---|
| 源代码（.ts/.tsx/.py 等） | ✅ 是 | 所有代码文件 |
| 数据库（*.db） | ✅ 是 | `smartgas.db` 已加入版本控制，数据随代码一起同步 |
| 环境配置（.env） | ❌ 否 | 包含密钥，不上传 |
| 依赖目录（node_modules/） | ❌ 否 | 体积过大，不上传 |
| 构建产物（dist/） | ❌ 否 | 可本地重新构建，不上传 |

> ⚠️ 数据库文件可能较大，如频繁变更建议只在重要节点手动提交

## Git 提交步骤

1. 添加所有更改（含数据库文件）
// turbo
```bash
& "F:\Program Files\Git\bin\git.exe" add .
```

2. 提交更改（需要填写提交信息）
```bash
& "F:\Program Files\Git\bin\git.exe" commit -m "描述本次更改"
```

3. 推送到远程仓库
// turbo
```bash
& "F:\Program Files\Git\bin\git.exe" push
```

4. 查看提交状态
// turbo
```bash
& "F:\Program Files\Git\bin\git.exe" status
```
