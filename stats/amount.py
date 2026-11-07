"""
stats/amount.py — 按金额维度统计（8号）

GET /api/stats/by-amount?from=YYYY-MM-DD&to=YYYY-MM-DD

返回：
{
  "count": 40,
  "total": 3520.80,
  "max": {"id": "...", "amount": 11303.37, "category": "工资", "date": "2026-08-16"},
  "min": {"id": "...", "amount": 5.00, "category": "饮食", "date": "2026-11-01"},
  "avg": 88.02,
  "top5": [{"id", "type", "category", "amount", "date", "note"}, ...],
  "distribution": [{"bucket": "0-50", "count": 20}, ...]
}

约定：
- from / to 均可省略，闭区间。
- 统计包含收入和支出，不按 type 过滤。
- 金额使用 Decimal 量化到分，避免浮点误差。
- 固定 6 个左闭右开区间；1000 元落在 "1000+"。
- 空数据时 max / min 为 null，其余数值为 0。
"""

from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Iterable

from flask import Blueprint, current_app, jsonify, request

import storage

bp = Blueprint("stats_amount", __name__, url_prefix="/api/stats")

CENT = Decimal("0.01")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# (展示名, 下限（含）, 上限（不含）)；上限 None 表示正无穷
BUCKETS: tuple[tuple[str, Decimal, Decimal | None], ...] = (
    ("0-50", Decimal("0"), Decimal("50")),
    ("50-100", Decimal("50"), Decimal("100")),
    ("100-200", Decimal("100"), Decimal("200")),
    ("200-500", Decimal("200"), Decimal("500")),
    ("500-1000", Decimal("500"), Decimal("1000")),
    ("1000+", Decimal("1000"), None),
)


def _error(message: str, status: int = 400):
    """统一错误结构：{"ok": false, "errors": [...]}"""
    return jsonify({"ok": False, "errors": [message]}), status


def _query_date(name: str) -> date | None:
    """读取并校验 from / to；空字符串视为未传。"""
    raw = (request.args.get(name) or "").strip()
    if not raw:
        return None
    if not DATE_RE.match(raw):
        raise ValueError(f"{name} 日期格式应为 YYYY-MM-DD")
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValueError(f"{name} 日期格式应为 YYYY-MM-DD") from exc


def _decimal_amount(record: dict[str, Any]) -> Decimal | None:
    """取出合法金额；非法/非正数返回 None（坏数据不参与统计）。"""
    try:
        value = Decimal(str(record.get("amount")))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not value.is_finite() or value <= 0:
        return None
    try:
        return value.quantize(CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation:
        return None


def _record_date(record: dict[str, Any]) -> date | None:
    raw = str(record.get("date", "")).strip()
    if not DATE_RE.match(raw):
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def _money(value: Decimal) -> float:
    return float(value.quantize(CENT, rounding=ROUND_HALF_UP))


def _bucket_for(amount: Decimal) -> str:
    for label, low, high in BUCKETS:
        if amount >= low and (high is None or amount < high):
            return label
    # 理论不可达；防御性兜底，避免坏数据让接口 500
    return BUCKETS[-1][0]


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    """max / min 使用的记录摘要。"""
    return {
        "id": row["record"].get("id"),
        "amount": _money(row["amount"]),
        "category": row["record"].get("category", ""),
        "date": row["day"].isoformat(),
    }


def build_stats(
    records: Iterable[dict[str, Any]],
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, Any]:
    """纯函数核心：筛选、汇总、Top5、区间分布（便于单测）。"""
    rows: list[dict[str, Any]] = []

    for record in records:
        if not isinstance(record, dict):
            continue

        day = _record_date(record)
        if day is None:
            continue
        if date_from is not None and day < date_from:
            continue
        if date_to is not None and day > date_to:
            continue

        amount = _decimal_amount(record)
        if amount is None:
            continue

        rows.append({"record": record, "day": day, "amount": amount})

    count = len(rows)
    total = sum((row["amount"] for row in rows), Decimal("0"))

    max_row = max(
        rows,
        key=lambda row: (row["amount"], row["day"]),
        default=None,
    )
    min_row = min(
        rows,
        key=lambda row: (row["amount"], row["day"]),
        default=None,
    )

    bucket_counts = {label: 0 for label, _low, _high in BUCKETS}
    for row in rows:
        bucket_counts[_bucket_for(row["amount"])] += 1

    # 金额降序；同金额时日期新的在前，保证演示结果稳定。
    top_rows = sorted(
        rows,
        key=lambda row: (row["amount"], row["day"]),
        reverse=True,
    )[:5]

    return {
        "count": count,
        "total": _money(total),
        "max": _summary(max_row) if max_row else None,
        "min": _summary(min_row) if min_row else None,
        "avg": _money(total / count) if count else 0.0,
        "top5": [
            {
                "id": row["record"].get("id"),
                "type": row["record"].get("type", ""),
                "category": row["record"].get("category", ""),
                "amount": _money(row["amount"]),
                "date": row["day"].isoformat(),
                "note": row["record"].get("note", "") or "",
            }
            for row in top_rows
        ],
        "distribution": [
            {"bucket": label, "count": bucket_counts[label]}
            for label, _low, _high in BUCKETS
        ],
    }


@bp.route("/by-amount", methods=["GET"])
def stats_by_amount():
    """金额分布统计接口。"""
    try:
        date_from = _query_date("from")
        date_to = _query_date("to")
    except ValueError as exc:
        return _error(str(exc))

    if date_from and date_to and date_from > date_to:
        return _error("from 不能晚于 to")

    try:
        records = storage.load_all()
    except Exception:  # noqa: BLE001 - 对外统一 500，细节进日志
        current_app.logger.exception("读取 records 失败")
        return _error("读取数据失败，请稍后重试", status=500)

    return jsonify(build_stats(records, date_from, date_to))
