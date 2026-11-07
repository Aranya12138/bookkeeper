from flask import Blueprint, request, jsonify
from database import get_db_connection

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

    # 2. 参数校验
    if trans_type not in ("expense", "income"):
        return jsonify({"error": "type 参数必须为 expense 或 income"}), 400

    # 3. 构建 SQL 查询
    sql = """
        SELECT
            category,
            SUM(amount) AS total_amount,
            COUNT(*) AS transaction_count
        FROM transactions
        WHERE type = ?
    """

    params = [trans_type]

    if start_date:
        sql += " AND date >= ?"
        params.append(start_date)

    if end_date:
        sql += " AND date <= ?"
        params.append(end_date)

    sql += """
        GROUP BY category
        ORDER BY total_amount DESC
    """

    # 4. 执行查询
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute(sql, params)
        rows = cursor.fetchall()

        # 5. 计算总金额
        total_amount = sum(float(row["total_amount"]) for row in rows)

        # 6. 组织返回数据
        result = []

        for row in rows:
            amount = float(row["total_amount"])

            percent = (
                round(amount / total_amount * 100, 2)
                if total_amount > 0 else 0
            )

            result.append({
                "category": row["category"],
                "amount": round(amount, 2),
                "percent": percent,
                "count": row["transaction_count"]
            })

        conn.close()

        return jsonify(result), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500
