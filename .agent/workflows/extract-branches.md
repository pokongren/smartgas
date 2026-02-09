---
description: 自动识别并提取复杂管线（如中缅线）的干线与支线结构
---

此命令主要用于自动分析数据库中混合的管线数据，通过检测里程重置点，自动将主干线与各个支线分离开来，并导出为 JSON 文件。

1. **默认行为**: 提取 "中缅线" 数据。
2. **自定义**: 通过修改命令参数提取其他管线。

执行命令：
// turbo
python backend/scripts/extract_trunk_and_branches.py "中缅线" --out "backend/data/extracted_structure.json"

> **完成提示**: 执行后请查看 `backend/data/extracted_structure.json` 获取提取结果。
