# -*- coding: utf-8 -*-
raw = open('docs/智脉平台评审汇报材料_痛点主线版.md', 'rb').read()
content = raw.decode('utf-8')

# 1. Delete Section 7
import re
# Match from "## 7. Demo 展示方案" up to but not including "## 8. 当前成果与不足"
pattern_sec7 = re.compile(r'---\r?\n\r?\n## 7\. Demo 展示方案.*?(?=\r?\n---\r?\n\r?\n## 8\. 当前成果与不足)', re.DOTALL)
content = pattern_sec7.sub('', content)

# 2. Renumber 8->7, 9->8, 10->9, 11->10
content = content.replace('## 8. 当前成果与不足', '## 7. 当前成果与不足')
content = content.replace('## 9. 评委可能追问与回答 (QA)', '## 8. 评委可能追问与回答 (QA)')
content = content.replace('## 10. 推荐 PPT 页序', '## 9. 推荐 PPT 页序')
content = content.replace('## 11. 收口话术', '## 10. 收口话术')

# 3. Fix PPT Table
old_table = (
    '| 5 | 说得明：复核与表达 | SubAgent 交叉复核与 Skill 严谨结论输出 |\r\n'
    '| 6 | 演示：架构与调用链 | 前后端分工与 AI 演示证据追踪 |'
)
new_table = (
    '| 5 | 说得明：六角色协同输出 | SubAgent 多智能体交叉查验与 Skill 安全兜底 |\r\n'
    '| 6 | 系统总体架构 | 四层解耦与可信计算底座 |'
)
# Note: the lines might have \n instead of \r\n depending on git, let's use regex to be safe
content = re.sub(r'\|\s*5\s*\|\s*说得明：复核与表达\s*\|\s*SubAgent 交叉复核与 Skill 严谨结论输出\s*\|', '| 5 | 说得明：六角色协同输出 | SubAgent 多智能体交叉查验与 Skill 安全兜底 |', content)
content = re.sub(r'\|\s*6\s*\|\s*演示：架构与调用链\s*\|\s*前后端分工与 AI 演示证据追踪\s*\|', '| 6 | 系统总体架构 | 四层解耦与可信计算底座 |', content)

open('docs/智脉平台评审汇报材料_痛点主线版.md', 'wb').write(content.encode('utf-8'))
print('写入成功，新文件字符数:', len(content))
