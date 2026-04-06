"""
修复 AI数据分析能力提升与Codex-Subagents实施方案.md
"""
FILEPATH = r'F:\smartgas-grid\docs\AI数据分析能力提升与Codex-Subagents实施方案.md'

with open(FILEPATH, 'rb') as f:
    raw = f.read()

# 统一换行
text = raw.decode('utf-8', errors='replace').replace('\r\n', '\n').replace('\r', '\n')

results = []

# ── 修改 1：删除具体缺口里的旧残留行 ──
# 新加的第6、7条之后还跟着旧的第2-5条，需要删除
old1 = (
    '7. **AI 面板布局未规划**：当前 AI 助手是固定宽度浮窗抽屉，趋势图卡片进入聊天区后空间严重不足，必须先确定布局方案再动图表卡片。\n'
    '2. `subagents` 现在只是提示词里的工作流描述，不是真正可执行的多代理分工体系。\n'
    '3. 图表组件能复用，但还没有 AI 报告卡片容器。\n'
    '4. 历史数据接口是\u201c按站/按枢纽取时序\u201d，还没有\u201c多站点横向对比报告接口\u201d。\n'
    '5. 趋势预测和风险分析能力有基础，但还不够覆盖\u201c水露点 + 多口压力 + 多口温度 + 未来走向 + 风险等级\u201d这一整套诊断报告。'
)
new1 = '7. **AI 面板布局未规划**：当前 AI 助手是固定宽度浮窗抽屉，趋势图卡片进入聊天区后空间严重不足，必须先确定布局方案再动图表卡片。'
if old1 in text:
    text = text.replace(old1, new1, 1)
    results.append('✅ 修改1：旧残留行删除成功')
else:
    # 尝试直引号版
    old1b = (
        '7. **AI 面板布局未规划**：当前 AI 助手是固定宽度浮窗抽屉，趋势图卡片进入聊天区后空间严重不足，必须先确定布局方案再动图表卡片。\n'
        '2. `subagents` 现在只是提示词里的工作流描述，不是真正可执行的多代理分工体系。\n'
        '3. 图表组件能复用，但还没有 AI 报告卡片容器。\n'
        '4. 历史数据接口是"按站/按枢纽取时序"，还没有"多站点横向对比报告接口"。\n'
        '5. 趋势预测和风险分析能力有基础，但还不够覆盖"水露点 + 多口压力 + 多口温度 + 未来走向 + 风险等级"这一整套诊断报告。'
    )
    if old1b in text:
        text = text.replace(old1b, new1, 1)
        results.append('✅ 修改1（备用引号）成功')
    else:
        results.append('❌ 修改1 失败')

# ── 修改 2：数据底座约束 两个→三个 ──
old2 = (
    '但也有两个现实约束：\n\n'
    '1. 当前历史库里没有查到中卫、武进的同类时序样本。\n'
    '2. `ScadaHistory` 模型支持 `dewpoint`，但现有历史查询链路和通用图组件还没有完整打通水露点场景。\n\n'
    '这意味着：\n\n'
    '- 甪直 24 小时压力/温度分析，适合先做成第一阶段样板。\n'
    '- \u201c中卫 + 甪直 + 武进 10 天水露点横向对比\u201d，业务上是对的，但落地前要先补齐多站点、多天、多指标数据接入。'
)
new2 = (
    '但也有三个现实约束：\n\n'
    '1. 当前历史库里没有查到中卫、武进的同类时序样本。\n'
    '2. `ScadaHistory` 模型支持 `dewpoint` 字段，但水露点场景有三层均未打通：\n'
    '   - 后端历史查询接口未覆盖 `dewpoint` 参数的完整查询路径\n'
    '   - 前端 `ScadaHistoryChart` 未支持水露点指标的独立展示\n'
    '   - AI 取数工具层也没有针对水露点的专项调用链路\n'
    '3. AI 助手面板目前是固定宽度浮窗，趋势图卡片进入后空间不足，布局方案尚未确定。\n\n'
    '这意味着：\n\n'
    '- 甪直 24 小时**压力/温度**分析，适合先做成第一阶段样板（数据和接口都就绪）。\n'
    '- 甪直水露点趋势分析，要在完成水露点三层打通之后再做，不要和样板并行开展。\n'
    '- \u201c中卫 + 甪直 + 武进 10 天水露点横向对比\u201d，业务上是对的，但落地前要先补齐多站点数据接入和水露点接口。'
)
if old2 in text:
    text = text.replace(old2, new2, 1)
    results.append('✅ 修改2：数据底座约束更新成功')
else:
    old2b = (
        '但也有两个现实约束：\n\n'
        '1. 当前历史库里没有查到中卫、武进的同类时序样本。\n'
        '2. `ScadaHistory` 模型支持 `dewpoint`，但现有历史查询链路和通用图组件还没有完整打通水露点场景。\n\n'
        '这意味着：\n\n'
        '- 甪直 24 小时压力/温度分析，适合先做成第一阶段样板。\n'
        '- "中卫 + 甪直 + 武进 10 天水露点横向对比"，业务上是对的，但落地前要先补齐多站点、多天、多指标数据接入。'
    )
    if old2b in text:
        text = text.replace(old2b, new2, 1)
        results.append('✅ 修改2（备用引号）成功')
    else:
        results.append('❌ 修改2 失败')

# ── 修改 3：执行顺序插入前置动作 ──
PREFIX = '\n\n## 前置动作：两个阻断项先处理（不做则后续卡住）\n\n'
# 如果前置动作已存在，跳过
if '## 前置动作' in text:
    results.append('⏭️ 修改3：前置动作已存在，跳过')
else:
    # 找到 ## 阶段 0 并在其前插入前置动作
    ANCHOR = '## 阶段 0：先做样板闭环'
    PRETEXT = (
        '## 前置动作：两个阻断项先处理（不做则后续卡住）\n\n'
        '### 前置 1：确认 AI 面板布局方案\n\n'
        '推荐方案：**加"报告展开模式"，而非改浮窗宽度**。\n\n'
        '具体做法：\n'
        '- AI 消息中渲染一个小卡片（趋势摘要 + 一行结论）\n'
        '- 卡片上有"查看完整报告"按钮\n'
        '- 点击后打开全宽报告面板（或独立弹层）\n'
        '- 这样不动现有浮窗布局，趋势图在大面板里完整展示\n\n'
        '好处：风险低、不破坏现有聊天体验、趋势图有足够空间。\n\n'
        '### 前置 2：水露点接口专项打通（三层）\n\n'
        '按下面顺序逐层验证：\n\n'
        '1. **DB 层**：确认 `scada_history.db` 中确实有 `dewpoint` 数据记录（不是只有字段没有数据）\n'
        '2. **API 层**：后端历史查询接口支持 `metric=dewpoint` 参数，并能正确返回时序\n'
        '3. **前端层**：`ScadaHistoryChart` 或新建组件能正确渲染水露点曲线\n\n'
        '三层都通之后，后续所有水露点功能才可以动。\n\n'
        '---\n\n'
    )
    if ANCHOR in text:
        text = text.replace(ANCHOR, PRETEXT + ANCHOR, 1)
        results.append('✅ 修改3：前置动作插入成功')
    else:
        results.append('❌ 修改3 阶段0锚点未找到')

# ── 修改 4：阶段1落点前插入兼容性要求 ──
if '兼容性要求（必须做）' in text:
    results.append('⏭️ 修改4：兼容性要求已存在，跳过')
else:
    old4 = (
        '### 落点\n\n'
        '- 前端：`useAiAssistantChat.ts`、`AiAssistant.tsx`\n'
        '- 后端：`ai_assistant.py`、`ai_analysis_orchestrator.py`'
    )
    new4 = (
        '### 兼容性要求（必须做）\n\n'
        '现有 SSE 流式返回是逐字符推送的，协议升级后需处理三点：\n\n'
        '1. **旧文本兼容**：如果后端返回中没有 `blocks` 字段，前端按纯文本消息渲染，不能崩掉\n'
        '2. **缺数据降级**：部分 `blocks` 取数失败时，整条消息不打崩，显示降级提示（"该站点暂无数据"）\n'
        '3. **流式 vs 批量**：结构化 `blocks` 建议在 SSE 流结束后一次性渲染，不要逐 token 尝试解析 JSON\n\n'
        '### 落点\n\n'
        '- 前端：`useAiAssistantChat.ts`（消息协议解析）、`AiAssistant.tsx`（渲染分发）\n'
        '- 后端：`ai_assistant.py`（返回格式）、`ai_analysis_orchestrator.py`（blocks 组装）'
    )
    if old4 in text:
        text = text.replace(old4, new4, 1)
        results.append('✅ 修改4：阶段1兼容性要求插入成功')
    else:
        results.append('❌ 修改4 落点段未找到')

# ── 写回文件 ──
with open(FILEPATH, 'w', encoding='utf-8', newline='\n') as f:
    f.write(text)

for r in results:
    print(r)
print('\n=== 全部完成 ===')
