"""
OptionsAI - 策略计算 API 路由
POST /api/strategies — 接收用户输入，返回 3-4 个推荐策略
"""
from fastapi import APIRouter, HTTPException
from backend.models.schemas import StrategyRequest, StrategyResponse
from backend.services.data_fetcher import DataFetcher
from backend.services.strategy_selector import StrategySelector

router = APIRouter(tags=["Strategies"])

_fetcher = DataFetcher()


@router.post("/strategies", response_model=StrategyResponse)
async def calculate_strategies(req: StrategyRequest):
    """
    根据用户输入（趋势、偏好、到期日）计算推荐策略

    请求体:
        ticker: 股票代码
        trend: 趋势预期 (10 种之一)
        target_price: 目标股价 (可选)
        target_pct: 目标涨跌幅 % (可选)
        expiration: 选定到期日
        preference_weight: 偏好权重 0-1 (0=高回报, 1=高胜率)
    """
    ticker = req.ticker.upper().strip()

    try:
        # 1. 获取市场数据
        spot_data = await _fetcher.get_spot_price(ticker)
        spot = spot_data["spot_price"]

        iv_data = await _fetcher.get_iv_metrics(ticker)
        iv_current = iv_data["iv_current"]
        iv_rank = iv_data["iv_rank"]

        # 2. 获取期权链
        chain = await _fetcher.get_options_chain(ticker, req.expiration)
        calls_df = chain["calls"]
        puts_df = chain["puts"]
        dte = chain["dte"]

        if calls_df.empty and puts_df.empty:
            raise HTTPException(status_code=404, detail=f"No options data for {ticker} on {req.expiration}")

        # 3. 计算目标价
        target_price = req.target_price
        if not target_price and req.target_pct:
            target_price = spot * (1 + req.target_pct / 100)

        # 4. 尝试获取远月期权链 (用于 Calendar/Diagonal Spread)
        # 远月到期日需要比近月至少远30天，理想为2倍DTE
        far_calls = None
        far_puts = None
        try:
            exps = await _fetcher.get_expirations(ticker)
            from datetime import datetime, timedelta
            near_date = datetime.strptime(req.expiration, "%Y-%m-%d")
            min_far_date = near_date + timedelta(days=max(30, dte))  # 至少30天后

            far_exp = None
            for exp in exps:
                exp_date = datetime.strptime(exp, "%Y-%m-%d")
                if exp_date >= min_far_date:
                    far_exp = exp
                    break

            if far_exp:
                far_chain = await _fetcher.get_options_chain(ticker, far_exp)
                far_calls = far_chain["calls"]
                far_puts = far_chain["puts"]
        except Exception:
            pass  # 远月数据获取失败不影响主流程

        # 5. 运行策略选择器
        selector = StrategySelector(
            calls_df=calls_df,
            puts_df=puts_df,
            spot=spot,
            iv_current=iv_current,
            iv_rank=iv_rank,
            dte=dte,
            expiration=req.expiration,
            far_calls_df=far_calls,
            far_puts_df=far_puts,
        )

        # 判断是否为区间模式
        range_kwargs = {}
        if req.target_price_upper is not None and req.target_price_lower is not None:
            range_kwargs["target_price_upper"] = req.target_price_upper
            range_kwargs["target_price_lower"] = req.target_price_lower

        strategies = selector.recommend(
            trend=req.trend,
            preference_weight=req.preference_weight,
            target_price=target_price,
            max_strategies=4,
            **range_kwargs,
        )

        if not strategies:
            raise HTTPException(
                status_code=404,
                detail="No valid strategies found. The options chain may lack sufficient data."
            )

        # 6. 根据预算和最大亏损过滤策略
        if req.budget or req.max_loss:
            filtered = []
            for s in strategies:
                # 预算过滤
                if req.budget and s.required_capital > req.budget:
                    continue
                # 最大亏损过滤
                if req.max_loss:
                    if req.max_loss_type == "percent" and req.budget:
                        loss_limit = req.budget * req.max_loss / 100
                    else:
                        loss_limit = req.max_loss
                    if abs(s.max_loss) > loss_limit:
                        continue
                filtered.append(s)
            # 至少保留1个策略（亏损最小的）
            if filtered:
                strategies = filtered
            else:
                strategies = [min(strategies, key=lambda s: abs(s.max_loss))]

        return StrategyResponse(
            ticker=ticker,
            spot_price=spot,
            iv_current=iv_current,
            iv_rank=iv_rank,
            expiration=req.expiration,
            strategies=strategies,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategy calculation error: {str(e)}")
