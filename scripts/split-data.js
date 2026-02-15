/**
 * 大数据文件分割脚本
 * 
 * 用途：将大型 JSON 数据文件分割成多个小 chunk，支持按需加载
 * 
 * 使用方法：
 * node scripts/split-data.js <input-file> [options]
 * 
 * 示例：
 * node scripts/split-data.js src/data/southernPipelineData.ts --chunk-size 100 --output public/data/
 */

const fs = require('fs');
const path = require('path');

// 解析命令行参数
const args = process.argv.slice(2);
const inputFile = args[0];
const chunkSizeArg = args.find(arg => arg.startsWith('--chunk-size=')) || '--chunk-size=100';
const outputDirArg = args.find(arg => arg.startsWith('--output=')) || '--output=public/data/';

if (!inputFile) {
  console.error('❌ 请提供输入文件路径');
  console.log('用法: node scripts/split-data.js <input-file> [--chunk-size=N] [--output=dir]');
  process.exit(1);
}

const CHUNK_SIZE = parseInt(chunkSizeArg.split('=')[1], 10) || 100;
const OUTPUT_DIR = outputDirArg.split('=')[1] || 'public/data/';

/**
 * 分割数据文件
 */
async function splitDataFile() {
  console.log(`📂 正在处理: ${inputFile}`);
  console.log(`📊 每块大小: ${CHUNK_SIZE} 条记录`);
  console.log(`📁 输出目录: ${OUTPUT_DIR}`);

  try {
    // 1. 读取输入文件
    const content = fs.readFileSync(inputFile, 'utf-8');
    
    // 2. 尝试解析为 JavaScript/TypeScript 导出
    let data;
    const exportMatch = content.match(/export\s+(?:const|let|var)\s+\w+\s*=\s*([\s\S]+);?$/);
    const defaultExportMatch = content.match(/export\s+default\s+([\s\S]+);?$/);
    
    if (exportMatch || defaultExportMatch) {
      // 是 JS/TS 文件，提取 JSON 部分
      const jsonStr = (exportMatch || defaultExportMatch)[1];
      // 移除可能的尾随分号
      const cleanJson = jsonStr.replace(/;\s*$/, '');
      data = eval(`(${cleanJson})`);
    } else {
      // 尝试作为纯 JSON 解析
      data = JSON.parse(content);
    }

    // 3. 确定数据类型并分割
    let items = [];
    let metadata = {};
    
    if (Array.isArray(data)) {
      items = data;
    } else if (data.features && Array.isArray(data.features)) {
      // GeoJSON 格式
      items = data.features;
      metadata = { ...data, features: undefined };
    } else if (data.pipelines || data.stations || data.valves) {
      // 自定义结构
      items = [
        ...(data.pipelines || []),
        ...(data.stations || []),
        ...(data.valves || []),
      ];
      metadata = { ...data, pipelines: undefined, stations: undefined, valves: undefined };
    } else {
      // 对象转数组
      items = Object.entries(data).map(([key, value]) => ({ id: key, ...value }));
    }

    console.log(`📈 总记录数: ${items.length}`);
    console.log(`📦 预计分块数: ${Math.ceil(items.length / CHUNK_SIZE)}`);

    // 4. 确保输出目录存在
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // 5. 生成索引文件
    const totalChunks = Math.ceil(items.length / CHUNK_SIZE);
    const indexData = {
      metadata: {
        totalItems: items.length,
        totalChunks,
        chunkSize: CHUNK_SIZE,
        createdAt: new Date().toISOString(),
        sourceFile: path.basename(inputFile),
        ...metadata,
      },
      chunks: Array.from({ length: totalChunks }, (_, i) => ({
        index: i,
        file: `chunk-${i}.json`,
        count: Math.min(CHUNK_SIZE, items.length - i * CHUNK_SIZE),
      })),
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'index.json'),
      JSON.stringify(indexData, null, 2)
    );
    console.log(`✅ 索引文件: ${path.join(OUTPUT_DIR, 'index.json')}`);

    // 6. 分割数据并写入 chunk 文件
    const chunks = [];
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
      const chunk = items.slice(i, i + CHUNK_SIZE);
      const chunkIndex = Math.floor(i / CHUNK_SIZE);
      const chunkFile = path.join(OUTPUT_DIR, `chunk-${chunkIndex}.json`);
      
      fs.writeFileSync(chunkFile, JSON.stringify(chunk));
      chunks.push(chunkFile);
      console.log(`✅ Chunk ${chunkIndex}: ${chunk.length} 条记录`);
    }

    // 7. 生成统计信息
    const stats = {
      sourceFile: inputFile,
      sourceSize: fs.statSync(inputFile).size,
      outputDir: OUTPUT_DIR,
      totalChunks,
      chunkSize: CHUNK_SIZE,
      totalItems: items.length,
      files: [
        'index.json',
        ...chunks.map(f => path.basename(f)),
      ],
    };

    console.log('\n📊 分割完成!');
    console.log('─────────────────────────────');
    console.log(`源文件大小: ${(stats.sourceSize / 1024).toFixed(2)} KB`);
    console.log(`输出文件数: ${stats.files.length}`);
    console.log(`平均每块: ${(items.length / totalChunks).toFixed(0)} 条记录`);
    console.log('─────────────────────────────');

    // 8. 生成加载示例代码
    const loaderExample = `
// 加载示例代码
import { DataLoader } from '@/utils/dataLoader';

const loader = new DataLoader();

// 加载索引
const index = await loader.load('/data/index.json');

// 按需加载特定 chunk
const chunk0 = await loader.load('/data/chunk-0.json');

// 或加载所有 chunks
const allChunks = await loader.loadChunks('/data', index.metadata.totalChunks);
`;

    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'README.md'),
      `# 分割数据文件
\n## 统计信息
- 源文件: ${inputFile}
- 总记录: ${items.length}
- 分块数: ${totalChunks}
- 每块大小: ${CHUNK_SIZE}
\n## 加载示例
\`\`\`typescript
${loaderExample}
\`\`\`
`
    );

    console.log(`📝 使用说明: ${path.join(OUTPUT_DIR, 'README.md')}`);

  } catch (error) {
    console.error('❌ 处理失败:', error.message);
    process.exit(1);
  }
}

// 执行分割
splitDataFile();
