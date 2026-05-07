"""
Professional Trader Agent router.

Endpoints:
  POST /api/trader/analyze/{ticker}   — SSE stream of 8 researchers + manager
  POST /api/trader/report             — Generate downloadable Word report
"""
from __future__ import annotations

import io
from typing import Literal, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field

from backend.services.ai_assistant import client, MODEL
from backend.services.data_fetcher import DataFetcher
from backend.services.ticker_validator import validate_us_ticker
from backend.services.trader_agent import TraderAgentPipeline, RESEARCHER_SPECS

router = APIRouter(tags=["Professional Trader Agent"])

_fetcher = DataFetcher()


def _ensure_us_ticker(ticker: str) -> str:
    t = ticker.upper().strip()
    result = validate_us_ticker(t)
    if not result.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_TICKER",
                "message_en": result.reason_en,
                "message_zh": result.reason_zh,
            },
        )
    return t


class TraderAnalyzeRequest(BaseModel):
    mode: Literal["stock", "options"] = Field(
        default="stock",
        description="Whether to analyze the underlying stock or its options",
    )
    locale: Literal["zh", "en"] = Field(default="en")
    # Optional subset of researchers to run. None / empty = all 9.
    # Saves LLM cost when the user only cares about specific perspectives.
    selected_researchers: Optional[list[str]] = Field(
        default=None,
        description="Optional list of researcher IDs to run; defaults to all 9",
    )


@router.post("/trader/analyze/{ticker}")
async def trader_analyze(ticker: str, req: TraderAnalyzeRequest = None):
    """
    Run the multi-agent trader pipeline. Streams Server-Sent Events.

    Each event is a JSON object — see TraderAgentPipeline for event schema.
    """
    if req is None:
        req = TraderAnalyzeRequest()

    ticker = _ensure_us_ticker(ticker)

    pipeline = TraderAgentPipeline(client, MODEL, _fetcher)

    async def event_stream():
        async for chunk in pipeline.run(ticker, req.mode, req.locale, req.selected_researchers):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ============================================================
# Word report generation
# ============================================================

class TraderReportRequest(BaseModel):
    ticker: str
    mode: Literal["stock", "options"]
    locale: Literal["zh", "en"] = "en"
    researchers: list[dict] = Field(default_factory=list)
    manager: dict = Field(default_factory=dict)


def _build_word_report(req: TraderReportRequest) -> bytes:
    """
    Generate a typeset Word .docx report.

    Layout overhaul rationale: the old version used `add_paragraph()` for every
    block, leaving Word to render plain Calibri 11pt with no headings, no
    spacing, no tables — which the user (rightly) called out as ugly. This
    rebuild uses Word's built-in heading styles (so the doc has a real outline
    and TOC support), tables for the decision summary, paragraph spacing, and
    a coloured rule line under the title.
    """
    from docx import Document
    from docx.shared import Pt, Inches, RGBColor, Cm
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.enum.table import WD_ALIGN_VERTICAL
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement

    is_zh = req.locale == "zh"
    doc = Document()

    # ----- Base styling --------------------------------------------------
    # Use Calibri (Latin) + 等线 (CJK) so Chinese characters render properly.
    base_font = "等线" if is_zh else "Calibri"
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    # Ensure CJK characters use a CJK font (python-docx default falls back to
    # Latin, which Word renders as ugly Times for Chinese).
    rPr = normal.element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:ascii"), "Calibri")
    rFonts.set(qn("w:hAnsi"), "Calibri")
    rFonts.set(qn("w:eastAsia"), base_font)
    rFonts.set(qn("w:cs"), "Calibri")

    # Heading styles — give them brand colour + slightly more weight
    accent = RGBColor(0x1E, 0x3A, 0x8A)  # deep blue (Tailwind blue-900)
    accent_soft = RGBColor(0x37, 0x4F, 0xC2)
    muted = RGBColor(0x5B, 0x66, 0x77)

    for level, size in [("Heading 1", 18), ("Heading 2", 14), ("Heading 3", 12)]:
        st = doc.styles[level]
        st.font.name = "Calibri"
        st.font.size = Pt(size)
        st.font.bold = True
        st.font.color.rgb = accent if level == "Heading 1" else accent_soft
        # Paragraph spacing
        st.paragraph_format.space_before = Pt(14 if level == "Heading 1" else 10)
        st.paragraph_format.space_after = Pt(6)
        # CJK font on heading
        h_rPr = st.element.get_or_add_rPr()
        h_rFonts = h_rPr.find(qn("w:rFonts"))
        if h_rFonts is None:
            h_rFonts = OxmlElement("w:rFonts")
            h_rPr.append(h_rFonts)
        h_rFonts.set(qn("w:eastAsia"), base_font)

    # Page margins
    for section in doc.sections:
        section.left_margin = Inches(0.9)
        section.right_margin = Inches(0.9)
        section.top_margin = Inches(0.9)
        section.bottom_margin = Inches(0.9)

    # ----- Helpers -------------------------------------------------------
    def _shade_cell(cell, hex_color: str) -> None:
        """Add background colour to a table cell (python-docx has no native API)."""
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hex_color)
        tcPr.append(shd)

    def add_para(
        text: str,
        *,
        bold: bool = False,
        italic: bool = False,
        size: float = 10.5,
        color: RGBColor = RGBColor(0x1F, 0x29, 0x37),
        alignment=None,
        space_after: float = 4,
    ):
        p = doc.add_paragraph()
        if alignment is not None:
            p.alignment = alignment
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.line_spacing = 1.35
        run = p.add_run(text or "—")
        run.bold = bold
        run.italic = italic
        run.font.size = Pt(size)
        run.font.color.rgb = color
        # Force CJK font
        rfonts = run._element.get_or_add_rPr().find(qn("w:rFonts"))
        if rfonts is None:
            rfonts = OxmlElement("w:rFonts")
            run._element.get_or_add_rPr().append(rfonts)
        rfonts.set(qn("w:eastAsia"), base_font)
        return p

    def add_heading(text: str, level: int = 1):
        h = doc.add_heading(text, level=level)
        h.paragraph_format.keep_with_next = True
        return h

    def add_kv_table(rows: list[tuple[str, str]]):
        """Two-column key-value table — used for the decision summary."""
        if not rows:
            return
        table = doc.add_table(rows=len(rows), cols=2)
        table.autofit = False
        table.columns[0].width = Cm(4.5)
        table.columns[1].width = Cm(11.5)
        for i, (label, value) in enumerate(rows):
            cell_l = table.cell(i, 0)
            cell_r = table.cell(i, 1)
            cell_l.width = Cm(4.5)
            cell_r.width = Cm(11.5)
            cell_l.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            cell_r.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            _shade_cell(cell_l, "EEF2FF")  # subtle blue tint for label column
            for cell, txt, is_label in ((cell_l, label, True), (cell_r, value or "—", False)):
                cell.text = ""
                p = cell.paragraphs[0]
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(2)
                run = p.add_run(txt)
                run.bold = is_label
                run.font.size = Pt(10.5)
                run.font.color.rgb = accent if is_label else RGBColor(0x1F, 0x29, 0x37)
                rf = run._element.get_or_add_rPr().find(qn("w:rFonts"))
                if rf is None:
                    rf = OxmlElement("w:rFonts")
                    run._element.get_or_add_rPr().append(rf)
                rf.set(qn("w:eastAsia"), base_font)

    def add_horizontal_rule(color: RGBColor = accent_soft, thickness_pt: int = 8):
        """A coloured rule line under the title block."""
        p = doc.add_paragraph()
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), str(thickness_pt))
        bottom.set(qn("w:space"), "1")
        bottom.set(qn("w:color"),
                   f"{color[0]:02X}{color[1]:02X}{color[2]:02X}")
        pBdr.append(bottom)
        pPr.append(pBdr)

    def add_bullet(text: str):
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(text)
        run.font.size = Pt(10.5)
        run.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)
        rf = run._element.get_or_add_rPr().find(qn("w:rFonts"))
        if rf is None:
            rf = OxmlElement("w:rFonts")
            run._element.get_or_add_rPr().append(rf)
        rf.set(qn("w:eastAsia"), base_font)

    def add_numbered(items: list[str]):
        for i, step in enumerate(items, 1):
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.left_indent = Cm(0.6)
            run_n = p.add_run(f"{i}. ")
            run_n.bold = True
            run_n.font.color.rgb = accent
            run_n.font.size = Pt(10.5)
            run_t = p.add_run(str(step))
            run_t.font.size = Pt(10.5)
            run_t.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)
            for r in (run_n, run_t):
                rf = r._element.get_or_add_rPr().find(qn("w:rFonts"))
                if rf is None:
                    rf = OxmlElement("w:rFonts")
                    r._element.get_or_add_rPr().append(rf)
                rf.set(qn("w:eastAsia"), base_font)

    # ----- Cover block ---------------------------------------------------
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_p.paragraph_format.space_before = Pt(0)
    title_p.paragraph_format.space_after = Pt(2)
    t_run = title_p.add_run(
        "OptionsAI 专业研究报告" if is_zh
        else "OptionsAI Professional Research Report"
    )
    t_run.bold = True
    t_run.font.size = Pt(22)
    t_run.font.color.rgb = accent
    rf = t_run._element.get_or_add_rPr().find(qn("w:rFonts"))
    if rf is None:
        rf = OxmlElement("w:rFonts")
        t_run._element.get_or_add_rPr().append(rf)
    rf.set(qn("w:eastAsia"), base_font)

    sub_p = doc.add_paragraph()
    sub_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub_p.paragraph_format.space_after = Pt(2)
    sub_run = sub_p.add_run(
        f"{req.ticker}  ·  "
        + (("期权策略分析" if req.mode == "options" else "股票投资分析") if is_zh
           else ("Options Strategy Analysis" if req.mode == "options" else "Equity Analysis"))
    )
    sub_run.font.size = Pt(13)
    sub_run.font.color.rgb = accent_soft
    sub_run.bold = True

    date_p = doc.add_paragraph()
    date_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    date_run = date_p.add_run(datetime.now().strftime('%Y-%m-%d %H:%M'))
    date_run.font.size = Pt(10)
    date_run.font.color.rgb = muted
    date_run.italic = True

    add_horizontal_rule()

    # ----- Executive Summary table --------------------------------------
    m = req.manager or {}
    add_heading("一、最终决策" if is_zh else "1. Final Decision", level=1)

    if req.mode == "stock":
        rows = [
            ("决策" if is_zh else "Recommendation",        str(m.get("decision", "—"))),
            ("信心度" if is_zh else "Conviction",          f"{m.get('conviction', '—')}/10"),
            ("时间周期" if is_zh else "Time Horizon",      str(m.get("time_horizon", "—"))),
            ("入场区间" if is_zh else "Entry Zone",        str(m.get("entry_zone", "—"))),
            ("目标价" if is_zh else "Target Price",        str(m.get("target_price", "—"))),
            ("止损价" if is_zh else "Stop Loss",           str(m.get("stop_loss", "—"))),
            ("仓位建议" if is_zh else "Position Sizing",   str(m.get("position_sizing", "—"))),
        ]
    else:
        rows = [
            ("策略" if is_zh else "Strategy",              str(m.get("decision", "—"))),
            ("方向" if is_zh else "Direction",             str(m.get("direction", "—"))),
            ("信心度" if is_zh else "Conviction",          f"{m.get('conviction', '—')}/10"),
            ("结构" if is_zh else "Structure",             str(m.get("structure", "—"))),
            ("到期日" if is_zh else "Expiration",          str(m.get("expiration", "—"))),
            ("最大亏损" if is_zh else "Max Loss",          str(m.get("max_loss", "—"))),
            ("最大盈利" if is_zh else "Max Profit",        str(m.get("max_profit", "—"))),
            ("盈亏平衡" if is_zh else "Breakeven",         str(m.get("breakeven", "—"))),
            ("胜率" if is_zh else "Win Probability",       str(m.get("win_probability", "—"))),
        ]
    add_kv_table(rows)

    # ----- Investment Thesis --------------------------------------------
    if m.get("thesis"):
        add_heading("二、投资逻辑" if is_zh else "2. Investment Thesis", level=1)
        add_para(str(m.get("thesis", "")), size=11, space_after=8)

    # ----- Catalysts / Risks --------------------------------------------
    catalysts = m.get("key_catalysts", []) or []
    risks = m.get("main_risks", []) or []
    if catalysts or risks:
        add_heading("三、催化剂与风险" if is_zh else "3. Catalysts & Risks", level=1)
        if catalysts:
            add_heading("关键催化剂" if is_zh else "Key Catalysts", level=2)
            for c in catalysts:
                add_bullet(str(c))
        if risks:
            add_heading("主要风险" if is_zh else "Main Risks", level=2)
            for r in risks:
                add_bullet(str(r))

    # ----- Actionable Steps ---------------------------------------------
    actionable = m.get("actionable_steps", []) or []
    if actionable:
        add_heading("四、执行步骤" if is_zh else "4. Actionable Steps", level=1)
        add_numbered([str(s) for s in actionable])

    # ----- Consensus + Debate -------------------------------------------
    consensus = m.get("consensus_score")
    debate = m.get("debate_summary")
    if consensus or debate:
        add_heading("五、研究共识与辩论" if is_zh else "5. Consensus & Debate", level=1)
        if consensus:
            add_heading("共识打分" if is_zh else "Consensus Score", level=2)
            add_para(str(consensus))
        if debate:
            add_heading("辩论复盘" if is_zh else "Debate Recap", level=2)
            add_para(str(debate), size=10.5, space_after=8)

    # ----- Per-analyst Synthesis (v3 lineup) ----------------------------
    synthesis = m.get("synthesis", {}) or {}
    if synthesis:
        add_heading("六、各分析师观点综合" if is_zh else "6. Per-Analyst Synthesis", level=1)
        # Pull labels from the canonical RESEARCHER_SPECS so the report
        # always matches the live analyst lineup.
        order = list(RESEARCHER_SPECS.keys())
        # Legacy v2 fallbacks so old saved analyses still render
        legacy_labels_zh = {"bull": "看多策略师", "bear": "看空策略师", "market": "宏观策略师",
                            "financial": "财务质量分析师", "news": "事件催化师", "options": "波动率策略师"}
        legacy_labels_en = {"bull": "Bull Researcher", "bear": "Bear Researcher", "market": "Macro Strategist",
                            "financial": "Earnings-Quality Analyst", "news": "Catalyst Analyst", "options": "Volatility Strategist"}
        synth_rows: list[tuple[str, str]] = []
        for key in order:
            text = synthesis.get(key)
            if text:
                spec = RESEARCHER_SPECS[key]
                label = spec["name_zh"] if is_zh else spec["name_en"]
                synth_rows.append((label, str(text)))
        # Preserve any legacy keys (bull/bear/etc.) that older history entries carry
        for key, text in synthesis.items():
            if key in order or not text:
                continue
            label = (legacy_labels_zh if is_zh else legacy_labels_en).get(key, key.title())
            synth_rows.append((label, str(text)))
        add_kv_table(synth_rows)

    # ----- Researcher Briefings -----------------------------------------
    if req.researchers:
        doc.add_page_break()
        add_heading("七、研究员独立简报" if is_zh else "7. Independent Research Briefings", level=1)

        stance_zh = {"bullish": "看多", "bearish": "看空", "neutral": "中性"}
        stance_color = {
            "bullish": RGBColor(0x16, 0x80, 0x4D),  # green
            "bearish": RGBColor(0xC0, 0x36, 0x36),  # red
            "neutral": RGBColor(0x6B, 0x72, 0x80),  # gray
        }

        for r in req.researchers:
            name = r.get("name_zh") if is_zh else r.get("name_en")
            stance = r.get("stance", "neutral")
            confidence = r.get("confidence", "—")
            stance_label = stance_zh.get(stance, stance) if is_zh else stance.title()

            add_heading(f"{r.get('icon', '•')}  {name}", level=2)

            # Stance + confidence badge line
            badge_p = doc.add_paragraph()
            badge_p.paragraph_format.space_after = Pt(4)
            stance_run = badge_p.add_run(f"{stance_label}")
            stance_run.bold = True
            stance_run.font.size = Pt(11)
            stance_run.font.color.rgb = stance_color.get(stance, muted)
            sep = badge_p.add_run("   ·   ")
            sep.font.color.rgb = muted
            conf_run = badge_p.add_run(
                ("信心度 " if is_zh else "Confidence: ") + f"{confidence}/10"
            )
            conf_run.font.size = Pt(10.5)
            conf_run.font.color.rgb = muted
            for run in (stance_run, sep, conf_run):
                rf = run._element.get_or_add_rPr().find(qn("w:rFonts"))
                if rf is None:
                    rf = OxmlElement("w:rFonts")
                    run._element.get_or_add_rPr().append(rf)
                rf.set(qn("w:eastAsia"), base_font)

            if r.get("headline"):
                add_para(str(r["headline"]), bold=True, size=11.5, color=accent_soft, space_after=6)

            if r.get("evidence"):
                add_heading("依据" if is_zh else "Evidence", level=3)
                add_para(str(r["evidence"]))

            key_points = r.get("key_points", []) or []
            if key_points:
                add_heading("关键要点" if is_zh else "Key Points", level=3)
                for kp in key_points:
                    add_bullet(str(kp))

            if r.get("risks"):
                add_heading("风险" if is_zh else "Risks", level=3)
                add_para(str(r["risks"]), italic=True, color=muted)

            # Debate rebuttal
            reb = r.get("rebuttal") or {}
            if reb:
                add_heading(
                    ("辩论回应" if is_zh else "Debate Response")
                    + (f"  →  {reb.get('opponent_id')}" if reb.get("opponent_id") else ""),
                    level=3,
                )
                if reb.get("rebuttal"):
                    add_para(("反驳：" if is_zh else "Rebuttal: ") + str(reb["rebuttal"]))
                if reb.get("reinforced_evidence"):
                    add_para(("强化证据：" if is_zh else "Reinforced Evidence: ") + str(reb["reinforced_evidence"]))
                if reb.get("concession"):
                    add_para(("诚实让步：" if is_zh else "Concession: ") + str(reb["concession"]),
                             italic=True, color=muted)

    # ----- Disclaimer ----------------------------------------------------
    doc.add_paragraph()
    add_horizontal_rule(color=muted, thickness_pt=4)
    disclaimer = (
        "免责声明：本报告由 OptionsAI 自动生成，仅供学习与研究使用。"
        "所有内容均基于公开市场数据，不构成投资建议。投资有风险，决策需谨慎。"
        if is_zh else
        "Disclaimer: This report is auto-generated by OptionsAI for educational and research purposes only. "
        "All content is based on public market data and does not constitute investment advice. "
        "All investments carry risk; please make decisions carefully."
    )
    add_para(disclaimer, italic=True, size=9, color=muted, alignment=WD_ALIGN_PARAGRAPH.CENTER)

    # Serialize to bytes
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@router.post("/trader/report")
async def trader_report(req: TraderReportRequest):
    """Generate a Word .docx report from a completed trader analysis."""
    if not req.ticker:
        raise HTTPException(status_code=400, detail="ticker required")

    try:
        data = _build_word_report(req)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {type(e).__name__}: {e}")

    filename = f"OptionsAI_Trader_Report_{req.ticker}_{datetime.now().strftime('%Y%m%d_%H%M')}.docx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/trader/researchers")
async def list_researchers():
    """Return the catalog of researchers (for UI display)."""
    return {
        "researchers": [
            {
                "id": key,
                "name_en": spec["name_en"],
                "name_zh": spec["name_zh"],
                "icon": spec["icon"],
                "color": spec["color"],
            }
            for key, spec in RESEARCHER_SPECS.items()
        ]
    }


# ============================================================
# Portfolio Greeks aggregation
# ============================================================

class PortfolioLeg(BaseModel):
    action: Literal["buy", "sell"]
    opt_type: Literal["call", "put"]
    strike: float
    quantity: int


class PortfolioPositionRequest(BaseModel):
    ticker: str
    legs: list[PortfolioLeg]
    dte_days: int
    entry_date: str = ""


class PortfolioGreeksRequest(BaseModel):
    positions: list[PortfolioPositionRequest]


@router.post("/portfolio/greeks")
async def aggregate_greeks(req: PortfolioGreeksRequest):
    """
    Aggregate Greeks across paper-portfolio positions.

    Sends back per-position Greeks + portfolio totals + scenario P&L
    (spot ±5%, IV ±5pts, crash, rally).

    All tickers are validated US-only. Failed-fetch tickers are reported
    in `fetch_errors` but do not abort the whole request — partial results
    are still useful for the user.
    """
    from backend.services.portfolio_greeks import (
        PortfolioPosition,
        aggregate_portfolio_greeks,
    )

    # Validate every ticker
    for pos in req.positions:
        result = validate_us_ticker(pos.ticker.upper().strip())
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "INVALID_TICKER",
                    "ticker": pos.ticker,
                    "message_en": result.reason_en,
                    "message_zh": result.reason_zh,
                },
            )

    # Convert request → service dataclass
    service_positions = [
        PortfolioPosition(
            ticker=p.ticker.upper().strip(),
            legs=[leg.model_dump() for leg in p.legs],
            dte_days=p.dte_days,
            entry_date=p.entry_date,
        )
        for p in req.positions
    ]

    try:
        return await aggregate_portfolio_greeks(service_positions, _fetcher)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Aggregation failed: {type(e).__name__}: {e}")
