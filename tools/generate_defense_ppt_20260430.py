from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt


ROOT = Path(r"F:\smartgas-grid")
DOCS = ROOT / "docs"
OUTPUT = DOCS / "2026-04-30-答辩主线试讲版.pptx"

IMG_MAIN = DOCS / "map-topology-refresh-after-fix.png"
IMG_STRESS = DOCS / "map-topology-refresh-stress-clean.png"
IMG_DEBUG = DOCS / "map-topology-refresh-debug.png"

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)


BG = RGBColor(11, 24, 39)
PANEL = RGBColor(20, 37, 63)
PANEL_2 = RGBColor(15, 23, 42)
ACCENT = RGBColor(13, 148, 136)
ACCENT_2 = RGBColor(56, 189, 248)
WARN = RGBColor(245, 158, 11)
TEXT = RGBColor(241, 245, 249)
MUTED = RGBColor(148, 163, 184)
WHITE = RGBColor(255, 255, 255)
DANGER = RGBColor(239, 68, 68)


def set_bg(slide, color=BG):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_textbox(slide, left, top, width, height, text, size=20, bold=False,
                color=TEXT, font_name="Microsoft YaHei", align=PP_ALIGN.LEFT):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.clear()
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.TOP
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.name = font_name
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    return box


def add_panel(slide, left, top, width, height, title=None, fill_color=PANEL, line_color=None):
    shape = slide.shapes.add_shape(
        MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE, left, top, width, height
    )
    fill = shape.fill
    fill.solid()
    fill.fore_color.rgb = fill_color
    shape.line.color.rgb = line_color or fill_color
    if title:
        add_textbox(slide, left + Inches(0.18), top + Inches(0.12), width - Inches(0.36), Inches(0.35),
                    title, size=16, bold=True)
    return shape


def add_bullets(slide, left, top, width, height, items, size=18, color=TEXT, level0_prefix="1. "):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.clear()
    tf.word_wrap = True
    for idx, item in enumerate(items, start=1):
        p = tf.paragraphs[0] if idx == 1 else tf.add_paragraph()
        p.alignment = PP_ALIGN.LEFT
        run = p.add_run()
        run.text = f"{idx}. {item}"
        run.font.name = "Microsoft YaHei"
        run.font.size = Pt(size)
        run.font.color.rgb = color
        if idx == 1:
            p.space_before = Pt(0)
        p.space_after = Pt(6)
    return box


def add_title(slide, title, subtitle=None):
    add_textbox(slide, Inches(0.6), Inches(0.4), Inches(9.8), Inches(0.6), title, size=28, bold=True)
    if subtitle:
        add_textbox(slide, Inches(0.62), Inches(1.05), Inches(8.6), Inches(0.4), subtitle, size=12, color=MUTED)
    bar = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, Inches(0.6), Inches(1.42), Inches(1.6), Inches(0.06))
    bar.fill.solid()
    bar.fill.fore_color.rgb = ACCENT
    bar.line.color.rgb = ACCENT


def add_metric_card(slide, left, top, width, height, label, value, note="", accent=ACCENT):
    add_panel(slide, left, top, width, height, fill_color=PANEL_2)
    add_textbox(slide, left + Inches(0.18), top + Inches(0.14), width - Inches(0.36), Inches(0.28),
                label, size=12, color=MUTED)
    add_textbox(slide, left + Inches(0.18), top + Inches(0.44), width - Inches(0.36), Inches(0.36),
                value, size=20, bold=True, color=WHITE)
    if note:
        add_textbox(slide, left + Inches(0.18), top + Inches(0.86), width - Inches(0.36), Inches(0.3),
                    note, size=10, color=accent)


def add_flow_box(slide, left, top, width, height, title, body, color_box):
    add_panel(slide, left, top, width, height, fill_color=color_box)
    add_textbox(slide, left + Inches(0.15), top + Inches(0.12), width - Inches(0.3), Inches(0.3),
                title, size=16, bold=True)
    add_textbox(slide, left + Inches(0.15), top + Inches(0.48), width - Inches(0.3), height - Inches(0.58),
                body, size=12, color=RGBColor(226, 232, 240))


def add_arrow(slide, left, top, width=Inches(0.45), height=Inches(0.22), color=ACCENT_2):
    shape = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.CHEVRON, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = color
    shape.line.color.rgb = color


def add_image(slide, path, left, top, width=None, height=None):
    if path.exists():
        slide.shapes.add_picture(str(path), left, top, width=width, height=height)


def build_slide_1():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_textbox(slide, Inches(0.7), Inches(0.75), Inches(6.8), Inches(0.9),
                "SmartGas Grid 答辩主线试讲版", size=30, bold=True)
    add_textbox(slide, Inches(0.72), Inches(1.72), Inches(7.2), Inches(0.8),
                "按当前代码收口：AI查库回答问题 → 手动跑仿真 → 快照对比验收 → AI解释结果", size=18, color=RGBColor(203, 213, 225))
    add_panel(slide, Inches(0.7), Inches(2.55), Inches(4.7), Inches(2.3), fill_color=PANEL)
    add_bullets(slide, Inches(0.9), Inches(2.85), Inches(4.2), Inches(1.8), [
        "15分钟只讲一条主线，不搞功能大串烧",
        "每个结论都带证据：来源、时间、样本量、关键数值",
        "任一模块出问题，都能在30秒内切回保底流程",
    ], size=16)
    add_metric_card(slide, Inches(0.72), Inches(5.15), Inches(1.85), Inches(1.1), "固定问题", "5 个")
    add_metric_card(slide, Inches(2.72), Inches(5.15), Inches(1.85), Inches(1.1), "固定场景", "2+1")
    add_metric_card(slide, Inches(4.72), Inches(5.15), Inches(1.85), Inches(1.1), "主线时长", "13-15 分钟")
    add_image(slide, IMG_MAIN, Inches(7.2), Inches(0.8), width=Inches(5.35))


def build_slide_2():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "一、为什么这条主线最稳", "把“代码真有的能力”和“现场真要讲的话”彻底对齐")
    add_flow_box(slide, Inches(0.7), Inches(1.9), Inches(2.55), Inches(1.55),
                 "第一段：AI查库", "证明系统真连业务数据，回答自带证据四件套。", RGBColor(17, 94, 89))
    add_arrow(slide, Inches(3.38), Inches(2.55))
    add_flow_box(slide, Inches(3.95), Inches(1.9), Inches(2.55), Inches(1.55),
                 "第二段：主仿真页", "在 #/map-topology 手动跑 steady_base 和异常场景。", RGBColor(30, 64, 175))
    add_arrow(slide, Inches(6.63), Inches(2.55))
    add_flow_box(slide, Inches(7.2), Inches(1.9), Inches(2.55), Inches(1.55),
                 "第三段：展示页", "在 #/topology 读快照、看基线、验前后变化。", RGBColor(22, 78, 99))
    add_arrow(slide, Inches(9.88), Inches(2.55))
    add_flow_box(slide, Inches(10.45), Inches(1.9), Inches(2.1), Inches(1.55),
                 "第四段：AI解释", "解释已生成结果，不抢求解职责。", RGBColor(83, 52, 131))
    add_panel(slide, Inches(0.72), Inches(4.15), Inches(12.0), Inches(2.3), "这版收口后，现场不再打架", fill_color=PANEL)
    add_bullets(slide, Inches(0.95), Inches(4.58), Inches(11.4), Inches(1.5), [
        "不再讲“同页 AI 自动接仿真”，因为主仿真页当前代码里默认隐藏 AI 面板",
        "不再讲“AI 直接触发仿真”是主流程，因为最稳链路仍然是手动点运行",
        "转而主打 run_id、快照、基线对比、证据四件套，这更像工程系统，不像演示拼盘",
    ], size=16)


def build_slide_3():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "二、代码已经给出的三层证据", "老师最关心的不是花活，是你这套东西到底有没有根据")
    add_panel(slide, Inches(0.75), Inches(1.8), Inches(3.8), Inches(4.8), "证据层 1：AI查库回答")
    add_bullets(slide, Inches(0.95), Inches(2.25), Inches(3.4), Inches(3.9), [
        "固定 5 问：数量、列表、对象详情、干线、全网概况",
        "回复统一带：数据来源、时间范围、样本量、关键数值",
        "末尾还有“完整性提示：是/否”，现场能直接点出来",
    ], size=15)
    add_panel(slide, Inches(4.78), Inches(1.8), Inches(3.8), Inches(4.8), "证据层 2：主仿真求解")
    add_bullets(slide, Inches(4.98), Inches(2.25), Inches(3.4), Inches(3.9), [
        "主入口在 #/map-topology，真能跑 steady_base 和异常场景",
        "现场只盯 4 个字段：solver_status、run_id、alert_count、avg_utilization",
        "运行后可立刻保存快照，给后续对比留痕",
    ], size=15)
    add_panel(slide, Inches(8.82), Inches(1.8), Inches(3.8), Inches(4.8), "证据层 3：快照对比验收")
    add_bullets(slide, Inches(9.02), Inches(2.25), Inches(3.35), Inches(3.9), [
        "展示页会同步主仿真结果，不是另起一套口径",
        "基线对比直接看总供气、未满足、利用率、告警数",
        "还能定位压力变化最大的节点和流量变化最大的管段",
    ], size=15)


def build_slide_4():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "三、答辩第一段：AI查库固定五问", "先证明真连数据，再往仿真走")
    add_panel(slide, Inches(0.7), Inches(1.85), Inches(5.6), Inches(4.9), "固定问题清单")
    add_bullets(slide, Inches(0.95), Inches(2.25), Inches(5.1), Inches(3.8), [
        "西气东输一线有多少个压气站",
        "帮我列出所有压气站",
        "介绍下古浪分输站",
        "列出所有干线管线",
        "管网整体概况",
    ], size=17)
    add_panel(slide, Inches(6.6), Inches(1.85), Inches(6.0), Inches(2.2), "老师此时要看到什么", fill_color=RGBColor(18, 52, 86))
    add_bullets(slide, Inches(6.82), Inches(2.28), Inches(5.55), Inches(1.3), [
        "不是只会聊天，而是能把对象、字段、数量、归属一起查出来",
        "每个回答都能当场指出证据字段，回答风格稳定，不跑飞",
    ], size=15)
    add_panel(slide, Inches(6.6), Inches(4.25), Inches(6.0), Inches(2.5), "证据四件套模板", fill_color=RGBColor(17, 94, 89))
    add_metric_card(slide, Inches(6.85), Inches(4.75), Inches(1.28), Inches(1.2), "来源", "数据库")
    add_metric_card(slide, Inches(8.22), Inches(4.75), Inches(1.28), Inches(1.2), "时间", "当前窗")
    add_metric_card(slide, Inches(9.59), Inches(4.75), Inches(1.28), Inches(1.2), "样本", "N 条")
    add_metric_card(slide, Inches(10.96), Inches(4.75), Inches(1.28), Inches(1.2), "关键值", "数量/字段")


def build_slide_5():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "四、答辩第二段：主仿真页跑基线", "这一页负责算，不负责聊天")
    add_image(slide, IMG_MAIN, Inches(6.2), Inches(1.45), width=Inches(6.35))
    add_panel(slide, Inches(0.72), Inches(1.75), Inches(5.0), Inches(4.9), "主讲重点")
    add_bullets(slide, Inches(0.95), Inches(2.18), Inches(4.55), Inches(3.7), [
        "进入 #/map-topology，先跑 steady_base，把主链打通",
        "这一步只讲一件事：拓扑、求解器、前端落图已经连起来了",
        "现场只看四个字段：solver_status、run_id、alert_count、avg_utilization",
        "这四个数后面会一路带到快照和对比页，不会出现“两套答案”",
    ], size=16)
    add_textbox(slide, Inches(6.25), Inches(6.0), Inches(6.0), Inches(0.35),
                "图示建议：主仿真页稳定运行后的界面截图", size=11, color=MUTED, align=PP_ALIGN.RIGHT)


def build_slide_6():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "五、答辩第三段：异常场景 + 快照留痕", "这一幕最像工程系统")
    add_panel(slide, Inches(0.7), Inches(1.85), Inches(4.2), Inches(4.95), "固定场景")
    add_bullets(slide, Inches(0.93), Inches(2.25), Inches(3.75), Inches(2.9), [
        "基线场景：steady_base",
        "异常主场景：zhongwei_trunk_break",
        "异常备用场景：zhongwei_compressor_offline",
        "动作顺序：切场景 → 运行 → 保存快照 → 选择基线",
    ], size=16)
    add_metric_card(slide, Inches(0.95), Inches(5.55), Inches(1.65), Inches(1.0), "主结论", "先算后存")
    add_metric_card(slide, Inches(2.8), Inches(5.55), Inches(1.65), Inches(1.0), "现场口径", "有 run_id")
    add_image(slide, IMG_STRESS, Inches(5.2), Inches(1.6), width=Inches(7.3))
    add_textbox(slide, Inches(5.25), Inches(6.02), Inches(7.0), Inches(0.35),
                "图示建议：异常场景运行后的主仿真页截图，可配一句“不是讲动画，是讲归档和可追溯”", size=11, color=MUTED)


def build_slide_7():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "六、答辩第四段：展示页做基线对比验收", "这一页不再算，它负责把前面的结果讲明白")
    add_panel(slide, Inches(0.72), Inches(1.82), Inches(4.6), Inches(4.95), "验收时重点看什么")
    add_bullets(slide, Inches(0.95), Inches(2.24), Inches(4.15), Inches(3.15), [
        "当前 run 和历史快照数量",
        "总供气变化、未满足需求变化",
        "平均利用率变化、告警数变化",
        "压力变化最大的节点、流量变化最大的管段",
    ], size=16)
    add_metric_card(slide, Inches(0.95), Inches(5.58), Inches(1.6), Inches(1.0), "这页角色", "负责验")
    add_metric_card(slide, Inches(2.73), Inches(5.58), Inches(1.6), Inches(1.0), "不是", "再求解", accent=WARN)
    add_image(slide, IMG_DEBUG, Inches(5.58), Inches(1.62), width=Inches(6.92))
    add_textbox(slide, Inches(5.62), Inches(6.02), Inches(6.7), Inches(0.35),
                "图示建议：第三张图若后续有正式截图，可直接替换这张占位图", size=11, color=MUTED)


def build_slide_8():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "七、答辩第五段：AI解释结果，但不替你算结果", "这句口径得稳，别说飘了")
    add_panel(slide, Inches(0.72), Inches(1.82), Inches(5.75), Inches(4.8), "主口径")
    add_bullets(slide, Inches(0.96), Inches(2.26), Inches(5.25), Inches(2.9), [
        "AI 不负责生成仿真结果，AI 负责解释已经生成并留痕的结果",
        "最稳讲法一：切到独立 AI 弹窗，围绕当前运行上下文问风险点、差异点、调度建议",
        "最稳讲法二：不演弹窗也行，直接口播后端已有 /simulation/evaluate 评价能力",
    ], size=16)
    add_panel(slide, Inches(6.72), Inches(1.82), Inches(5.55), Inches(2.15), "建议现场固定三问", fill_color=RGBColor(83, 52, 131))
    add_bullets(slide, Inches(6.96), Inches(2.22), Inches(5.1), Inches(1.2), [
        "这个异常场景最值得关注的风险点是什么",
        "和基线比最明显的变化在哪里",
        "如果是调度员下一步应该先做什么",
    ], size=14)
    add_panel(slide, Inches(6.72), Inches(4.18), Inches(5.55), Inches(2.44), "老师追问时的短回法", fill_color=RGBColor(18, 52, 86))
    add_bullets(slide, Inches(6.96), Inches(4.58), Inches(5.08), Inches(1.5), [
        "为什么不让 AI 直接触发仿真：今天主答辩按最稳工程链走，结果和页面口径必须一致",
        "为什么不在同页解读：主仿真页优先保求解和地图流畅，AI改为独立解释更符合系统分层",
    ], size=13)


def build_slide_9():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_title(slide, "八、30秒故障回退卡", "临场真出事，别慌，照这张走")
    add_panel(slide, Inches(0.75), Inches(1.8), Inches(5.75), Inches(4.9), "A 流程：完整闭环", fill_color=RGBColor(17, 94, 89))
    add_bullets(slide, Inches(1.0), Inches(2.22), Inches(5.2), Inches(2.0), [
        "AI查库 → 第一张图跑仿真 → 保存快照 → 第三张图做基线对比 → AI解释结果",
        "适合现场网络、服务、页面都稳的时候走",
    ], size=16)
    add_panel(slide, Inches(6.78), Inches(1.8), Inches(5.75), Inches(4.9), "B 流程：保底版", fill_color=RGBColor(127, 29, 29))
    add_bullets(slide, Inches(7.03), Inches(2.22), Inches(5.15), Inches(2.2), [
        "AI查库 → 直接读取已有快照 → 第三张图看基线对比 → 口播 AI 评价能力已在后端预留",
        "这样主结论不断档，只是把“实时跑”换成“已有 run 讲解”",
    ], size=16)
    add_panel(slide, Inches(0.75), Inches(5.35), Inches(11.78), Inches(1.25), "现场短句", fill_color=PANEL)
    add_textbox(slide, Inches(0.98), Inches(5.68), Inches(11.2), Inches(0.55),
                "仿真慢：我先切到已归档结果，不影响主结论。  AI慢：我先继续讲 run_id 和基线对比。  地图异常：我直接看快照和结果卡片，今天重点是求解链和证据链。",
                size=14, color=RGBColor(226, 232, 240))


def build_slide_10():
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    set_bg(slide)
    add_textbox(slide, Inches(0.95), Inches(0.95), Inches(11.4), Inches(0.8),
                "最后就落三句话", size=28, bold=True, align=PP_ALIGN.CENTER)
    add_panel(slide, Inches(1.0), Inches(2.0), Inches(11.25), Inches(3.45), fill_color=PANEL)
    add_bullets(slide, Inches(1.35), Inches(2.45), Inches(10.5), Inches(2.5), [
        "第一，我们不是在演聊天，而是在演一条带证据的工程链",
        "第二，系统既能查业务数据，也能跑稳态仿真，还能用快照把结果留痕和对比",
        "第三，AI 在这里负责查和讲，不和求解抢活，所以口径稳、结论可追溯",
    ], size=20)
    add_textbox(slide, Inches(2.1), Inches(5.95), Inches(9.0), Inches(0.4),
                "谢谢各位老师，欢迎直接按这条主线提问。", size=18, color=RGBColor(148, 163, 184), align=PP_ALIGN.CENTER)


for builder in (
    build_slide_1,
    build_slide_2,
    build_slide_3,
    build_slide_4,
    build_slide_5,
    build_slide_6,
    build_slide_7,
    build_slide_8,
    build_slide_9,
    build_slide_10,
):
    builder()

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
prs.save(str(OUTPUT))
print(OUTPUT)
