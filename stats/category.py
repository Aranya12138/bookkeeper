
"""
stats/category.py — 按类别维度统计（7号）
GET /api/stats/by-category?type=expense|income&from=&to=
"""

from flask import Blueprint, request, jsonify
from collections import defaultdict
from datetime import datetime

import storage

bp = Blueprint("stats_category", __name__, url_prefix="/api/stats")


@bp.route("/by-category", methods=["GET"])
def stats_by_category():
    """
    按类别统计

    Query:
        type=expense|income
        from=YYYY-MM-DD
        to=YYYY-MM-DD

    返回:
        [
          {
            "category": "饮食",
            "amount": 520.50,
            "percent": 35.2,
            "count": 15
          }
        ]
    """

    # 1. 获取请求参数
    trans_type = request.args.get("type")
    start_date = request.args.get("from")
    end_date = request.args.get("to")

    # 2. 校验收支类型
    if trans_type not in ("expense", "income"):
        return jsonify({
            "error": "type 参数必须为 expense 或 income"
        }), 400

    # 3. 校验日期格式
    try:
        if start_date:
            datetime.strptime(start_date, "%Y-%m-%d")

        if end_date:
            datetime.strptime(end_date, "%Y-%m-%d")

        if start_date and end_date and start_date > end_date:
            return jsonify({
                "error": "开始日期不能晚于结束日期"
            }), 400

    except ValueError:
        return jsonify({
            "error": "日期格式必须为 YYYY-MM-DD"
        }), 400

    # 4. 从 records.json 读取全部记录
    try:
        records = storage.load_all()
    except Exception:
        return jsonify({
            "error": "读取交易记录失败"
        }), 500

    # 5. 按类别汇总
    category_stats = defaultdict(lambda: {
        "amount": 0.0,
        "count": 0
    })

    for record in records:

        # 筛选收支类型
        if record.get("type") != trans_type:
            continue

        # 获取交易日期
        record_date = record.get("date", "")

        # 筛选开始日期
        if start_date and record_date < start_date:
            continue

        # 筛选结束日期
        if end_date and record_date > end_date:
            continue

        # 获取类别和金额
        category = record.get("category") or "未分类"

        try:
            amount = float(record.get("amount", 0))
        except (ValueError, TypeError):
            continue

        # 忽略非法金额
        if amount < 0 or not __import__("math").isfinite(amount):
            continue

        # 累加金额和交易笔数
        category_stats[category]["amount"] += amount
        category_stats[category]["count"] += 1

    # 6. 计算总金额
    total_amount = sum(
        item["amount"]
        for item in category_stats.values()
    )

    # 7. 生成统计结果
    result = []

    for category, data in category_stats.items():

        amount = data["amount"]

        percent = (
            amount / total_amount * 100
            if total_amount > 0 else 0
        )

        result.append({
            "category": category,
            "amount": round(amount, 2),
            "percent": round(percent, 2),
            "count": data["count"]
        })

    # 8. 按金额降序排列
    result.sort(
        key=lambda item: item["amount"],
        reverse=True
    )

    return jsonify(result), 200
