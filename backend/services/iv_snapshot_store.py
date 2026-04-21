"""
OptionsAI - IV Snapshot Store

真实 IV Rank / IV Percentile 需要历史 IV 时间序列，而 Yahoo Finance
不提供历史 IV 数据。本模块把每次请求时抓到的 ATM IV 作为日快照持久化到
SQLite，系统运行 30+ 交易日之后即可计算真正的 IV Rank（而不是用 HV 代理）。

数据源 100% 真实：每一条记录都是某一天某个 ticker 真实抓取到的 ATM IV。
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "iv_snapshots.db"


def _ensure_db_dir() -> None:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS iv_snapshots (
            ticker     TEXT NOT NULL,
            snap_date  TEXT NOT NULL,   -- ISO date (UTC) YYYY-MM-DD
            iv_atm     REAL NOT NULL,   -- ATM IV in percent
            hv_30      REAL NOT NULL,   -- HV(30) in percent, for drift checks
            recorded_at TEXT NOT NULL,  -- ISO datetime UTC
            PRIMARY KEY (ticker, snap_date)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_iv_snapshots_ticker_date "
        "ON iv_snapshots(ticker, snap_date DESC)"
    )


@contextmanager
def _connect() -> Generator[sqlite3.Connection, None, None]:
    _ensure_db_dir()
    conn = sqlite3.connect(_DB_PATH, timeout=5.0, isolation_level=None)
    try:
        _init_schema(conn)
        yield conn
    finally:
        conn.close()


def record_snapshot(ticker: str, iv_atm: float, hv_30: float) -> None:
    """
    Record today's ATM IV snapshot. Idempotent per (ticker, date): re-calling
    on the same UTC day overwrites the earlier value, so the last read of the
    day wins.
    """
    ticker = ticker.upper().strip()
    if iv_atm <= 0 or iv_atm > 500:
        # Reject obviously invalid readings so we never poison the series.
        return

    now_utc = datetime.now(timezone.utc)
    snap_date = now_utc.date().isoformat()
    recorded_at = now_utc.isoformat()

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO iv_snapshots(ticker, snap_date, iv_atm, hv_30, recorded_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(ticker, snap_date) DO UPDATE SET
                iv_atm = excluded.iv_atm,
                hv_30 = excluded.hv_30,
                recorded_at = excluded.recorded_at
            """,
            (ticker, snap_date, float(iv_atm), float(hv_30), recorded_at),
        )


def get_iv_series(ticker: str, days: int = 252) -> list[float]:
    """
    Return up to `days` most recent IV values for `ticker`, oldest-first.
    Empty list if we have nothing recorded yet.
    """
    ticker = ticker.upper().strip()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT iv_atm FROM iv_snapshots
            WHERE ticker = ?
            ORDER BY snap_date DESC
            LIMIT ?
            """,
            (ticker, int(days)),
        ).fetchall()
    # reverse to oldest-first for rank math downstream
    return [r[0] for r in reversed(rows)]


def count_snapshots(ticker: str) -> int:
    ticker = ticker.upper().strip()
    with _connect() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM iv_snapshots WHERE ticker = ?", (ticker,)
        ).fetchone()
    return int(row[0]) if row else 0


def oldest_snapshot_date(ticker: str) -> Optional[str]:
    ticker = ticker.upper().strip()
    with _connect() as conn:
        row = conn.execute(
            "SELECT MIN(snap_date) FROM iv_snapshots WHERE ticker = ?", (ticker,)
        ).fetchone()
    return row[0] if row and row[0] else None
