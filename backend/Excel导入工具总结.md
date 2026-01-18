# Excel 导入工具使用总结

## ✅ 已完成

### 创建的工具
1. **import_excel.py** - 单个 Excel 文件导入(支持中文列名)
2. **import_multi_sheet.py** - 多 Sheet Excel 导入(详细版)
3. **import_ultimate.py** - 终极版 Excel 导入(推荐⭐)
4. **import_batch_csv.py** - 批量 CSV 导入

### 生成的模板
- ✅ `数据导入模板.xlsx` - 单文件模板
- ✅ `多Sheet导入模板.xlsx` - 多 Sheet 模板

---

## 🎯 推荐使用: import_ultimate.py

### 优势
- ✅ 自动识别工作表类型
- ✅ 使用 SQLModel ORM(数据验证)
- ✅ 导入到标准表(前端兼容)
- ✅ 简洁易用
- ✅ 完善的错误处理

### 使用方法

#### 1. 查看 Excel 结构
```bash
python scripts/import_ultimate.py --show-structure --file 你的文件.xlsx
```

#### 2. 导入数据(清空现有)
```bash
python scripts/import_ultimate.py --file 你的文件.xlsx --clear
```

#### 3. 导入数据(追加)
```bash
python scripts/import_ultimate.py --file 你的文件.xlsx
```

---

## 📊 Excel 文件格式

### 工作表命名规则

**站场/设施** (导入到 `stations` 表):
- `分输口` → type: distribution
- `压缩机` / `压缩机站` → type: compressor
- `储气库` / `气源站` → type: source

**管线** (导入到 `pipelines` 表):
- `干线管道` → category: trunk
- `支线管道` → category: branch

### 列名要求

**站场工作表**:
| 名称 | 经度 | 纬度 | 设计压力(MPa) |
|------|------|------|--------------|

**管线工作表**:
| 管道名称 | 起点 | 终点 | 管径(mm) | 长度(km) | 类别 |
|---------|------|------|---------|---------|------|

---

## 🚀 快速开始

### 方式 1: 使用模板
1. 打开 `多Sheet导入模板.xlsx`
2. 填写数据
3. 运行: `python scripts/import_ultimate.py --file 多Sheet导入模板.xlsx --clear`

### 方式 2: 使用自己的 Excel
1. 按照格式创建工作表
2. 运行: `python scripts/import_ultimate.py --show-structure --file 你的文件.xlsx`
3. 确认无误后导入

---

## 📝 测试结果

已成功导入模板数据:
- ✅ 5 个站场(2个分输口 + 2个压缩机 + 1个储气库)
- ✅ 3 条管线(2条干线 + 1条支线)
- ✅ 前端可以正常显示

---

## 💡 下一步

1. 刷新前端查看数据: http://localhost:3001
2. 准备你的实际数据 Excel 文件
3. 使用 `import_ultimate.py` 导入
