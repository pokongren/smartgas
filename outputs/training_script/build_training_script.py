from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


OUT_DIR = Path(__file__).resolve().parent
DOCX_PATH = OUT_DIR / "国家管网调控中心新员工入职培训讲稿_智脉平台.docx"
MD_PATH = OUT_DIR / "国家管网调控中心新员工入职培训讲稿_智脉平台.md"


TITLE = "智脉平台视角下的天然气调控入门"
SUBTITLE = "国家管网调控中心新员工入职培训讲稿"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_cell_text(cell, text: str, bold: bool = False) -> None:
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run(text)
    run.bold = bold
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    run.font.size = Pt(9)


def add_table(doc: Document, headers: list[str], rows: list[list[str]]) -> None:
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = "Table Grid"
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        set_cell_shading(cell, "EAF1F8")
        set_cell_text(cell, h, bold=True)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for row in rows:
        cells = table.add_row().cells
        for i, value in enumerate(row):
            set_cell_text(cells[i], value)
            cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    doc.add_paragraph()


def set_doc_styles(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(11)

    for name, size, color in [
        ("Title", 22, "17365D"),
        ("Subtitle", 12, "5F6B7A"),
        ("Heading 1", 16, "17365D"),
        ("Heading 2", 13, "24425F"),
        ("Heading 3", 11, "24425F"),
    ]:
        style = styles[name]
        style.font.name = "Microsoft YaHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(color)
        if "Heading" in name or name == "Title":
            style.font.bold = True


def add_para(doc: Document, text: str, style: str | None = None, bold_lead: bool = False) -> None:
    p = doc.add_paragraph(style=style)
    p.paragraph_format.line_spacing = 1.15
    p.paragraph_format.space_after = Pt(6)
    if bold_lead and "：" in text:
        lead, rest = text.split("：", 1)
        r1 = p.add_run(lead + "：")
        r1.bold = True
        r2 = p.add_run(rest)
        for r in [r1, r2]:
            r.font.name = "Microsoft YaHei"
            r._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    else:
        r = p.add_run(text)
        r.font.name = "Microsoft YaHei"
        r._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")


def add_bullets(doc: Document, items: list[str]) -> None:
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.line_spacing = 1.12
        p.paragraph_format.space_after = Pt(4)
        r = p.add_run(item)
        r.font.name = "Microsoft YaHei"
        r._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        r.font.size = Pt(10.5)


def build_markdown() -> str:
    return """# 智脉平台视角下的天然气调控入门

国家管网调控中心新员工入职培训讲稿

建议时长：60-75 分钟  
适用对象：调控中心新入职员工、轮岗见习人员、参与生产运行协同的业务人员  
材料来源：提纲.doc；智脉平台 SQL 数据库 smartgas.db、raw_excel_index.db；RAG/Chroma 库 smartgas_knowledge_docs

## 一、开场

各位同事，今天这堂课咱们不把天然气调控讲成一本厚规程，也不把智脉平台讲成一堆按钮。要我说，先抓一句话：调控工作的核心，是把资源、管网、用户和安全边界放在同一张图里看清楚、算明白、交接顺。

大家刚进调控中心，最容易觉得调控就是看 SCADA、接电话、下指令。这个理解没错，但只说到一半。真正的调控，是在每一个“上载、下载、转供、注采、启停机、流程切换”的背后，把商务订单、生产能力、现场条件、规程边界和异常预案一并捋顺。智脉平台的价值就在这里：SQL 管结构化家底，RAG 管规程和预案，仿真管趋势判断，最后由调控员做确认和决策。

今天按四块讲：第一，新增上下载点流程；第二，管网气源和运行特点；第三，用户分类及城燃、工业、发电用户特点；第四，储气库与 LNG 的运行特点。讲完以后，大家至少要形成一个基本反射：任何一个气量动作，都不能只看气量本身，还要看压力、管存、计量调压、远控条件、PPS 配置和应急边界。

## 二、检索口径和数据底账

本讲稿检索了三类数据。第一类是 smartgas.db，当前收录 13 个管道系统、1280 个站场节点、1263 段管线、25 个交汇点分组和 1440 条 SCADA 历史数据；其中站场节点按类型看，阀室 903 个、分输站 257 个、压气站 96 个。第二类是 raw_excel_index.db，原始索引库显示一级、二级管道合计 62 条，里程 62540.284806 km，站场 1016 座，阀室 2422 座，压气站 111 座，压缩机 412 台；另有供气点 937 个、分输口 1633 个。第三类是 Chroma RAG 库，集合名 smartgas_knowledge_docs，1536 维向量，当前 3020 个文本块，主要包括操作规程、集团公司级应急预案、调控中心级应急预案和新九项材料。

这里先提醒一句：数据库字段和原始业务表存在口径差异，比如气源能力字段在应用库中名为 capacity_mcm_per_day，但原始表多处用“104m3/d”，也就是万方/日口径。培训讲稿里涉及能力时，统一按“平台字段原值/万方日口径待业务复核”使用，不私自换算。安全、压力、输量这类数字，不能靠猜。

## 三、新增上下载点流程

### 1.1 商务流程

讲师口播：新增上下载点，表面看是新接一个用户或者新接一个气源，实质上是把一个新的交易关系放进管网运行秩序。商务流程先行，不是因为商务比生产重要，而是因为没有清楚的合同、订单和责任边界，生产动作就没有稳定依据。

商务流程一般从需求提出开始。上载点关注的是资源方能不能稳定供、气质是否符合入网要求、压力和计量边界是否清楚；下载点关注的是用户性质、合同接气压力、小时/日/月气量曲线、计量结算和应急限供安排。调控新人要注意，订单不是一串数字，它背后对应具体站场、具体流向、具体时段和具体能力占用。

智脉平台在这一段主要做三件事。第一，用 SQL 查底账：这个点归属哪条管道、哪个调度台、附近有哪些站场阀室、既有分输口和计量调压配置是什么。第二，用 RAG 查规则：新增上下载涉及运行方案传递、流程切换、控制权限、气质要求和异常处置时，平台能把对应规程和预案找出来。第三，用仿真或能力复核做判断：新增气量进来或出去，对上下游压力、关键瓶颈、管存和压缩机配置有什么影响。

新人要记住一句话：商务流程交给生产的不是“请你开一下”，而是“在什么时段、什么气量、什么压力、什么边界条件下运行”。

### 1.2 生产流程

讲师口播：生产流程的核心，是确认这个点能不能安全、可控、可计量、可调度地进入运行。说得接地气一点，不能只问“有没有管子”，还得问“有没有表、有没有阀、有没有调压、有没有远传、有没有应急退路”。

生产流程建议按六步讲给新人听。第一步，基础资料核对：站场名称、管道归属、上下载属性、投产状态、作业区、里程、压力等级、计量和调压设备。第二步，能力核算：复核管道剩余能力、站场计量能力、调压能力、过滤分离能力和上下游压力承受范围。第三步，控制条件核对：SCADA 点位、远控条件、报警联锁、控制权限和操作票据是否齐全。第四步，运行方案编制：明确启用时间、气量爬坡、压力控制、异常回退和现场监护安排。第五步，投产或切换执行：严格按审批后的操作程序执行，流程切换前确认流程无误，实际操作宜有专人监护。第六步，运行复盘：核对实际气量、压力、温度、计量偏差和用户反馈，必要时修正 PPS 和平台底账。

RAG 规程里反复出现几个硬要求：管道运行控制分为中心控制、站控控制、就地控制三种模式；具备中心控制功能的站场设备宜采取中心控制方式操作；控制权限切换应经过调度同意；流程切换遵循“先开后关”，高低压衔接部位按先低压后高压导通、先高压后低压切断的原则处理；球阀全开或全关，前后差压大于 0.5 MPa 时宜先平衡压力；进入管道的天然气气质应符合 GB/T 37124 和 GB 17820。

这些不是背诵题，是保命题。新人上岗后，看到任何绕过点位、绕过流程、绕过审批的动作，都要第一时间提高警惕。

### 1.3 流程双方工作交接

讲师口播：新增上下载点最容易出问题的地方，不一定在技术最难的地方，往往在交接最碎的地方。商务说“订单已经有了”，生产说“点位还没配完”，现场说“阀门能开”，调度一看“PPS 里找不到点”，这就容易乱。

交接时建议盯住四张清单。第一张是订单清单：用户或资源方名称、上下下载类型、合同压力、计划气量、起止时间、调度台归属。第二张是点位清单：PPS 点位、SCADA 点位、计量点、压力点、温度点、阀位点、报警点是否一致。第三张是能力清单：剩余能力复核结论、瓶颈段、调压和计量备用配置、必要的压缩机或转供配合。第四张是责任清单：商务、市场、生产、调度、现场、信息系统各自完成什么、何时完成、谁确认。

提纲里专门写了“PPS 缺失点位配置、订单上下载剩余能力复核”，这非常关键。PPS 缺点位，意味着运行方案传递和执行闭环会缺一个抓手；剩余能力没复核，意味着订单数字可能和物理管网能力脱节。一个在系统里查不到，一个在管网里跑不通，最后都不能交给调度员硬扛。

## 四、管网气源以及运行特点、能力

讲师口播：气源不是一个词，是一组性格完全不同的资源。国产气、陆上进口气、海上 LNG、煤层气、煤制气、储气库采气，进入管网后的表现不一样，调控策略也不一样。

国产气，典型如长庆、塔里木、西南油气田，特点是基础供给属性强，通常承担较稳定的底盘资源，但也会受上游处理厂、气田生产、检修和外输压力影响。平台应用库中有轮南气源，字段原值显示能力 250、当前 220；这类数据适合拿来做“当前能力和计划气量是否匹配”的快速核对。

陆上进口气，典型有中亚方向霍尔果斯、中缅方向瑞丽、中俄方向黑河。平台应用库中霍尔果斯气源字段原值为能力 300、当前 280；黑河气源为能力 380、当前 350；瑞丽气源为能力 52、当前 45。讲给新人时要强调，进口气的调控重点不只是量，还有边境计量、跨境协调、气质波动、合同曲线和长距离输送压力梯度。

海上 LNG，特点是调峰能力强、靠近沿海负荷中心、启动调整相对灵活，但受船期、接收站罐容、气化能力、外输管道能力、天气海况和市场安排影响。原始索引库中能检索到多条 LNG 外输管道，例如青岛 LNG 接收站至南京末站的青宁线干线 536.232 km、滨海 LNG 外输管道干线 494.88 km 且设计压力 10 MPa、深圳 LNG 外输管道 64.3 km 且字段显示设计输量 4600、漳州 LNG 外输管道 123.25 km 且字段显示设计输量 1150.68。新人要记住，LNG 是调峰利器，但不是想加就无限加，外输通道和下游接纳能力同样是硬边界。

煤制气和煤层气，常见特点是资源点相对集中、上载压力和稳定性需要持续跟踪，遇到管网压力升高或流程调整时，容易出现“上得来但疏不走”的矛盾。RAG 规程里提到影响上下载的维检修宜与上下游单位同步开展，对输量影响较大的维检修宜安排在管道输量较低时开展，这对这类气源尤其重要。

储气库采气，是季节调峰和应急保障的重要手段。原始库中收录 29 条储气库相关记录，代表性设施包括呼图壁、双台子（双六）、相国寺、文23、大港、国网金坛、苏桥、刘庄等。字段原值显示，呼图壁设计工作气量 45.1 亿方、最大采气能力 3300、最大注气能力 1550；双台子（双六）设计工作气量 54.1 亿方、最大采气能力 3300、最大注气能力 2600；文23 设计工作气量 32.7 亿方、最大采气能力 2600、最大注气能力 1800；国网金坛设计工作气量 17.1 亿方、最大采气能力 1500、最大注气能力 820。这里仍按数据库字段原值表述，正式对外材料需由业务部门确认单位口径。

这一段给新人的结论很简单：气源调度不是凑总量，而是组合不同资源的“性格”。稳定资源保底，LNG 和储气库调峰，进口气看合同和边境协调，煤制气/煤层气看上载压力和疏散通道。智脉平台的作用，是把这些信息放到一张运行图上，帮调度员少漏项、快定位、能复核。

## 五、用户分类以及用气特点

讲师口播：如果说气源是“气从哪儿来”，用户就是“气往哪儿去”。天然气用户大致可以分成城燃、工业、发电三类。三类用户的用气曲线、压力要求、停限气影响完全不同，调控不能一把尺子量到底。

### 城燃用户

城燃用户连接千家万户，特点是民生属性强、峰谷明显、季节性强。冬季采暖、早晚炊事、寒潮过程都会让需求快速变化。原始索引库中能看到多个城燃分输口样例，比如淄博城燃、吉林城燃、东城燃气、老城燃气、粤北城燃翁源等；合同接气压力字段中可见 2.5-4.0 MPa、3.2-3.6 MPa 等不同区间。给新人讲时要强调，城燃用户不是“平均每天多少气”这么简单，关键在小时峰值和民生兜底。

### 工业用户

工业用户通常负荷相对连续，但对停气、低压、气质波动非常敏感。化工、冶金、建材、园区用户一旦中断，可能造成装置停车、产品报废或安全风险。平台原始库中，工业园区、石化企业、园区分输站等记录较多。工业用户调控重点是提前沟通检修、掌握最低保安用气、明确降量梯度，不能等压力掉下来了再临时找人。

### 发电用户

发电用户的特点是“跟着电走”。迎峰度夏、迎峰度冬、极端天气和电网调峰都会带来短时高负荷。原始库中能检索到海南发电、龙鼓滩分输站、大唐如皋电厂支线、阜宁电厂支线等记录。发电用户一般气量大、调整快，但对管网压力冲击也明显。调控时既要看用户需求，也要看电网指令、机组启停、管存承受能力和上游补气能力。

### 自动分输和压力控制

原始索引库中分输口 1633 个，按调度台统计，东部 410 个、北部 348 个、中部 340 个、南部 221 个、省网 180 个、西部 141 个。自动分输字段显示为一期、二期、三期、四期、五期、六期、已投、不改等状态，这更像项目建设或改造批次，不应简单等同于“已自动/未自动”。讲稿里只把它作为平台记录口径，不把它强行解释成投运结论。

站场计量和调压设备里常见“1用1备”“2用1备”“1用0备”等配置。新人要理解，这些不是设备台账里的闲话，而是运行韧性。一个主路故障时能不能切备用，一台计量设备检修时能不能保证结算，一套调压装置异常时能不能稳住用户压力，都在这些配置里。

RAG 规程里关于分输调压装置有一条很实用：调压装置按照设定压力从高到低，一般为安全截断阀、监控调压阀、工作调压阀，或安全截断阀（双阀）、工作调压阀；安全截断阀紧急截断后，现场人员应查明原因，排除异常后及时恢复备用。这句话给新人翻译一下就是：工作调压负责日常，监控调压负责兜一层，安全截断负责最后边界。越靠后越不能随便碰。

## 六、储气库与 LNG 运行特点

讲师口播：储气库和 LNG，都是调控员手里的重要调峰资源，但它俩脾气不一样。储气库像蓄水池，适合季节平衡和区域支撑；LNG 像外部快速补给，适合沿海负荷和突发增量，但要受接收站和外输通道制约。

储气库运行的关键词是“注采转换、压力周期、库容约束、井控安全”。夏季通常注气，冬季通常采气，遇到区域压力低、保供紧张或上游来气不足时，储气库可以快速补缺口。但储气库不是无限提款机，采气能力、井口压力、地层压力、注采计划和井控安全都是边界。RAG 库中储气库井控突发事件专项预案把井控风险、事件分级、应急通信、电力保障、医疗救护、外部抢险资源都纳入体系，这说明储气库调度不能只看气量，还要看地下工程和应急保障。

LNG 运行的关键词是“船期、罐容、气化、外输、下游消纳”。比如滨海、江苏、唐山、青岛、天津、深圳、漳州、粤东、海南等 LNG 外输通道，在原始索引库里都有对应管道或支线记录。LNG 的优势是增量相对快、靠近沿海负荷中心、调峰效果直观；约束是接收站气化能力、外输管道压力、下游用户接纳能力和海况船期。实际运行中，LNG 增量后不能马上又大幅降量，否则容易造成管存和压力的来回摆动。

给新人讲储气库和 LNG，最好结合一句运行经验：资源进退要有序衔接。上游来气恢复后，LNG 不宜立刻“一刀切”降下来；储气库采气也不宜只看当天缺口，要看后续几天压力、管存和天气。智脉平台的价值，是把 SQL 的能力和位置、RAG 的规程边界、仿真的压力趋势放到一起，给调控员一个更完整的判断画面。

## 七、智脉平台使用示范话术

讲师口播：最后给大家一个平台使用的实战框架。遇到一个问题，不要先问“AI 怎么说”，先问“我要查什么证据”。

第一步，用 SQL 查事实。例如问：“当前平台收录多少分输口、哪些分输口归东部调度台、某站计量调压配置是什么、某条 LNG 外输管道设计压力是多少。”SQL 适合回答有明确字段、有明确表、有明确数量的问题。

第二步，用 RAG 查规则。例如问：“流程切换原则是什么、控制权限怎么切、管输气质依据什么标准、分输调压装置保护顺序是什么、发生严重泄漏或火灾爆炸时如何启动应急体系。”RAG 适合回答规程、预案、制度依据的问题。

第三步，用仿真和经验做判断。例如问：“某 LNG 增量后，哪个管段压力先上来；某储气库采气增加后，下游分输站压力能不能稳住；某新增下载点投运后，是否挤占既有用户能力。”这一步不能只交给模型，必须由调控员结合实时 SCADA、运行方案和现场反馈确认。

第四步，输出结论和边界。一个合格的调控结论至少包括：能不能做、什么时候做、做到多少、谁确认、异常怎么退、哪些数字需要复核。没有边界的建议，再像建议也不能直接执行。

## 八、收束

今天这堂课收束成三句话。第一，新增上下载点不是单点投运，是商务、生产、调度、现场和系统的一次闭环交接。第二，气源和用户都有性格，调控不是凑平衡表，而是在压力、管存、能力和安全边界里找最稳的组合。第三，智脉平台是助手，不是替班调度员；SQL 给事实，RAG 给依据，仿真给趋势，最终的调度指令必须由人按规程确认。

各位新同事以后坐到调度席上，别怕系统复杂。复杂归复杂，它也有脉络：气从哪来、往哪去、路上能不能走、边界能不能守住。把这四件事想清楚，调控这门活儿就算入了门。
"""


def build_docx(md: str) -> None:
    doc = Document()
    set_doc_styles(doc)
    section = doc.sections[0]
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.3)
    section.right_margin = Cm(2.3)

    header = section.header.paragraphs[0]
    header.text = "国家管网调控中心新员工入职培训"
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    header.runs[0].font.size = Pt(9)
    header.runs[0].font.color.rgb = RGBColor(100, 110, 120)
    header.runs[0].font.name = "Microsoft YaHei"
    header.runs[0]._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.text = "智脉平台培训讲稿"
    footer.runs[0].font.size = Pt(9)
    footer.runs[0].font.color.rgb = RGBColor(100, 110, 120)

    p = doc.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run(TITLE)
    p = doc.add_paragraph(style="Subtitle")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run(SUBTITLE)
    add_para(doc, "建议时长：60-75 分钟")
    add_para(doc, "适用对象：调控中心新入职员工、轮岗见习人员、参与生产运行协同的业务人员")
    add_para(doc, "数据来源：提纲.doc；智脉平台 SQL 数据库 smartgas.db、raw_excel_index.db；RAG/Chroma 库 smartgas_knowledge_docs")

    add_table(
        doc,
        ["检索对象", "关键结果", "讲稿用途"],
        [
            ["smartgas.db", "13 个管道系统、1280 个站场节点、1263 段管线", "平台结构化家底"],
            ["raw_excel_index.db", "62 条管道、62540.284806 km、1016 座站场、1633 个分输口", "原始业务台账口径"],
            ["Chroma RAG", "3020 个文本块，覆盖操作规程、应急预案、新九项等", "规程与预案依据"],
        ],
    )

    doc.add_page_break()

    heading_map = {
        "# ": "Title",
        "## ": "Heading 1",
        "### ": "Heading 2",
    }
    skip_header_lines = 8
    for raw in md.splitlines()[skip_header_lines:]:
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# "):
            continue
        if line.startswith("## "):
            add_para(doc, line[3:], "Heading 1")
        elif line.startswith("### "):
            add_para(doc, line[4:], "Heading 2")
        elif line.startswith("- "):
            add_bullets(doc, [line[2:]])
        elif line.startswith("建议时长") or line.startswith("适用对象") or line.startswith("材料来源"):
            continue
        else:
            add_para(doc, line, bold_lead=line.startswith("讲师口播") or line.startswith("新人要记住"))

    doc.save(DOCX_PATH)


def main() -> None:
    md = build_markdown()
    MD_PATH.write_text(md, encoding="utf-8")
    build_docx(md)
    print(DOCX_PATH)
    print(MD_PATH)


if __name__ == "__main__":
    main()
