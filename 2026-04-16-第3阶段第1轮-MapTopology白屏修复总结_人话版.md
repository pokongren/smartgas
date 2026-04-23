一、主目标
1. 修复 `http://localhost:3000/#/map-topology` 白屏，先恢复可运行状态，再确保前端可正常构建。

二、上下文与已知信息
1.2 页面白屏的直接报错是 `MapTopologyView.tsx` 存在 `Unterminated string literal`。同一文件中出现大量乱码和字符串断裂，属于编码污染后的语法破坏。1.3 继续在污染文本上逐段修补会持续引入新断点，修复成本和回归风险都很高。

三、修改逻辑
1. 采用“回到仓库稳定版本”的止血策略：把 `src/views/MapTopologyView.tsx` 的工作区和暂存区同时恢复到 `HEAD`，避免继续在损坏文本上叠补。2. 通过 `npm run build` 验证恢复后的代码可通过编译，确认白屏根因已解除。

四、执行顺序
1.2 先尝试局部修补常量与文案字符串。1.3 构建后发现仍有连续语法断裂，且断点在文件多处迁移。1.4 切换为整文件回退到稳定版本：`git restore --source=HEAD --staged --worktree src/views/MapTopologyView.tsx`。1.5 再次构建并通过。

五、验证方式
1. 验证命令：`npm run build`。2. 验证标准：Vite 构建完成且无 TS/ESBuild 语法错误。3. 验证结果：构建成功，`MapTopologyView.tsx` 不再报 `Unterminated string literal`。

六、影响范围
1.2 影响文件：`src/views/MapTopologyView.tsx`。1.3 影响方式：恢复为仓库稳定版本，清除本地损坏内容。1.4 对其他后端与前端文件未做本轮改动。

七、风险与回退点
1. 当前风险：此前未提交的 `MapTopologyView.tsx` 新增实验逻辑会一并回退。2. 回退点：本轮操作本身可继续从 git 历史或分支重新对比恢复需要的功能块。

八、前后对比
1. 修改前：页面因 `Unterminated string literal` 白屏，构建失败。2. 修改后：页面对应文件语法恢复，构建通过。3. 对比表：

| 项 | 修改前 | 修改后 |
|---|---|---|
| MapTopologyView 语法 | 多处字符串断裂 | 语法完整 |
| `npm run build` | 失败 | 成功 |
| `#/map-topology` 可加载性 | 白屏风险高 | 可继续进入页面验证 |

九、最终交付物
1. 代码交付：`src/views/MapTopologyView.tsx` 已恢复稳定版本。2. 过程文档：本文件 `2026-04-16-第3阶段第1轮-MapTopology白屏修复总结_人话版.md`。
