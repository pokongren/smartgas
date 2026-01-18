# 智慧管网系统 - 全链路逻辑流转图

本文档描述了数据如何从用户输入（自然语言/Excel）流转至数据库，最终经过清洗映射到前端地图展示的完整闭环。

```mermaid
graph TD
    %% 定义角色和层级
    User((👨‍✈️ 调度员))
    
    subgraph Frontend [💻 前端 (React)]
        ChatBox[💬 对话框<br/>(输入自然语言)]
        Uploader[📂 上传按钮<br/>(导入 Excel/CSV)]
        MapRender[🗺️ MapView<br/>(地图渲染引擎)]
    end

    subgraph Backend_Process [⚙️ 后端处理 (FastAPI)]
        Router_In[📥 接收接口]
        
        subgraph Data_Conversion [数据清洗与转换]
            NLP_Engine[🧠 NLP 解析器<br/>(提取意图: 这里的A连到B)]
            Excel_Parser[📊 Pandas 解析器<br/>(读取表格行)]
        end
        
        CRUD[💾 写入逻辑]
    end

    subgraph Database [🗄️ 数据库 (SQLite)]
        DB_Raw[(SmartGas.db<br/>存所有原始数据)]
    end

    subgraph Backend_Output [📤 后端输出 (FastAPI)]
        Router_Out[🔍 查询接口<br/>(带筛选参数)]
        Schema_Filter[⚡ Pydantic 筛子<br/>(只保留画图需要的数据)]
    end

    %% 流程 1: 数据录入 (Input)
    User -- "西二线从A连到B" --> ChatBox
    User -- "上传 pipes.xlsx" --> Uploader
    
    ChatBox -- POST /nlp/add --> Router_In
    Uploader -- POST /upload --> Router_In
    
    Router_In --> NLP_Engine
    Router_In --> Excel_Parser
    
    NLP_Engine -- 结构化数据 --> CRUD
    Excel_Parser -- 结构化数据 --> CRUD
    
    CRUD -- INSERT --> DB_Raw

    %% 流程 2: 数据展示 (Output)
    MapRender -- "我要看广州的管线" <br/> (GET /pipes?city=Guangzhou) --> Router_Out
    
    Router_Out -- SELECT WHERE city='Guangzhou' --> DB_Raw
    DB_Raw -- 返回原始大宽表 --> Router_Out
    
    Router_Out -- 过滤敏感字段 --> Schema_Filter
    Schema_Filter -- 纯净 JSON --> MapRender
    
    MapRender -- 绘制线条 --> User