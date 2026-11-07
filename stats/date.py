"""
stats/date.py — 按时间维度统计（6号）
GET /api/stats/by-date?granularity=day|week|month&from=&to=

只读接口：从 storage.load_all()（统一读取函数）取原始记录后按时间分组聚合，不在此实现存储。
聚合只用记录里的 date / type / amount 三个字段。
注意：CONTRACT.md 中记录的备注字段叫 note（不是 remark），本接口不涉及备注，故无影响。

返回格式（json 数组，period 标签随粒度变化）：
[
  {"period": "2026-11", "income": 3500.0, "expense": 1200.0, "balance": 2300.0},
  ...
]
其中 balance = income - expense
"""

from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

import storage

bp = Blueprint("stats_date", __name__, url_prefix="/api/stats")

# 合法粒度
GRANULARITIES = ("day", "week", "month")

DATE_FORMAT = "%Y-%m-%d"


def _json_error(message, status=400):
    """统一错误响应，与 CONTRACT.md 约定一致：{"ok": false, "errors": [...]}"""
    return jsonify({"ok": False, "errors": [message]}), status


def _parse_date(value):
    """严格解析 YYYY-MM-DD，非字符串或非法日期返回 None"""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.strptime(value, DATE_FORMAT)
    except ValueError:
        return None
    # strptime 会接受 2026-1-1 这类未补零写法，回写格式化后再比对一次
    if parsed.strftime(DATE_FORMAT) != value:
        return None
    return parsed.date()


def _period(day, granularity):
    """
    把某个日期归入对应周期，返回 (label, sort_key)：
    - day:   标签即日期 "YYYY-MM-DD"
    - week:  标签 "YYYY-Www"（ISO 周，周一为一周起点）
    - month: 标签 "YYYY-MM"
    sort_key 为可字典序排序的字符串，保证最终输出按时间先后排列。
    """
    if granularity == "day":
        return day.isoformat(), day.isoformat()
    if granularity == "month":
        return day.strftime("%Y-%m"), day.strftime("%Y-%m")

    # week：使用 ISO 周；用周一日期做排序基准，跨年周也能正确排序
    iso = day.isocalendar()
    label = f"{iso.year}-W{iso.week:02d}"
    week_start = day - timedelta(days=day.weekday())  # weekday(): 周一=0
    return label, week_start.isoformat()


def _to_amount(value):
    """把记录里的金额转成 float；非法（含 NaN / Infinity）返回 None"""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


@bp.route("/by-date", methods=["GET"])
def stats_by_date():
    """
    按时间维度统计收支
    Query: granularity=day|week|month（必填）, from=YYYY-MM-DD（必填）, to=YYYY-MM-DD（必填）
    成功: 返回 [{period, income, expense, balance}]
    失败: 400 {"ok": false, "errors": ["..."]}
    """
    # ── 1. 参数校验 ──
    granularity = (request.args.get("granularity") or "").strip().lower()
    if not granularity:
        return _json_error("缺少参数 granularity，可选值：day / week / month")
    if granularity not in GRANULARITIES:
        return _json_error(f"granularity 不合法：{granularity}，可选值：day / week / month")

    from_raw = (request.args.get("from") or "").strip()
    to_raw = (request.args.get("to") or "").strip()
    if not from_raw:
        return _json_error("缺少参数 from，格式：YYYY-MM-DD")
    if not to_raw:
        return _json_error("缺少参数 to，格式：YYYY-MM-DD")

    from_date = _parse_date(from_raw)
    to_date = _parse_date(to_raw)
    if from_date is None:
        return _json_error(f"from 日期非法：{from_raw}，格式应为 YYYY-MM-DD")
    if to_date is None:
        return _json_error(f"to 日期非法：{to_raw}，格式应为 YYYY-MM-DD")
    if from_date > to_date:
        return _json_error("from 不能晚于 to")

    # ── 2. 读取原始记录（统一读取函数，不实现存储） ──
    records = storage.load_all()

    # ── 3. 过滤 [from, to] 区间 + 按粒度分组求和 ──
    groups = {}  # label -> {"income": float, "expense": float, "sort": str}

    for record in records:
        if not isinstance(record, dict):
            continue

        record_type = record.get("type")
        if record_type not in ("income", "expense"):
            continue

        amount = _to_amount(record.get("amount"))
        if amount is None:
            continue

        record_date = _parse_date(record.get("date"))
        if record_date is None or not (from_date <= record_date <= to_date):
            continue

        label, sort_key = _period(record_date, granularity)
        if label not in groups:
            groups[label] = {"income": 0.0, "expense": 0.0, "sort": sort_key}
        groups[label][record_type] += amount

    # ── 4. 组装结果，按时间先后排序 ──
    result = []
    for label, group in sorted(groups.items(), key=lambda item: item[1]["sort"]):
        income = round(group["income"], 2)
        expense = round(group["expense"], 2)
        result.append({
            "period": label,
            "income": income,
            "expense": expense,
            "balance": round(income - expense, 2),
        })

    return jsonify(result)
