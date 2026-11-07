"""
routes/query.py — 查看模块路由

GET /api/records       分页查询（支持筛选、排序、关键字搜索）
GET /api/records/<id>  单条详情
"""

from flask import Blueprint, request, jsonify

import storage

bp = Blueprint("query", __name__, url_prefix="/api/records")

# 排序方式 → (排序字段, 是否降序)
SORT_RULES = {
    "date_asc": ("date", False),
    "date_desc": ("date", True),
    "amount_asc": ("amount", False),
    "amount_desc": ("amount", True),
}

# 单页最多返回的条数，防止一次拉全量
MAX_PAGE_SIZE = 100

DEFAULT_PAGE_SIZE = 10


def _to_int(value, default):
    """把查询参数转成整数，非法值回落到默认值"""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _sort_key(field):
    """金额按数值比较；日期按字符串比较（YYYY-MM-DD 的字典序即时间序），
    同一天再按 created_at 比较，保证翻页时顺序稳定、不重不漏。"""
    if field == "amount":
        return lambda r: float(r.get("amount") or 0)
    return lambda r: (str(r.get("date") or ""), str(r.get("created_at") or ""))


@bp.route("", methods=["GET"])
def list_records():
    """
    分页查询记录

    Query 参数：
      type       expense / income，缺省表示不限
      category   类别，缺省表示不限
      date_from  起始日期（含），YYYY-MM-DD
      date_to    结束日期（含），YYYY-MM-DD
      q          关键字，匹配备注
      sort       date_asc / date_desc / amount_asc / amount_desc，默认 date_desc
      page       页码，默认 1
      page_size  每页条数，默认 10，最大 100

    返回：{"ok": true, "items": [...], "total": int, "page": int, "pages": int}
    """
    records = storage.load_all()

    # 筛选：每一步都在上一步的结果上继续过滤，各条件可以任意组合
    record_type = request.args.get("type")
    if record_type in ("expense", "income"):
        records = [r for r in records if r.get("type") == record_type]

    category = request.args.get("category")
    if category:
        records = [r for r in records if r.get("category") == category]

    date_from = request.args.get("date_from")
    if date_from:
        records = [r for r in records if str(r.get("date") or "") >= date_from]

    date_to = request.args.get("date_to")
    if date_to:
        records = [r for r in records if str(r.get("date") or "") <= date_to]

    keyword = (request.args.get("q") or "").strip()
    if keyword:
        records = [r for r in records if keyword in (r.get("note") or "")]

    # 排序
    field, reverse = SORT_RULES.get(request.args.get("sort"), ("date", True))
    records.sort(key=_sort_key(field), reverse=reverse)

    # 分页：先把页码收敛到有效范围，再切片
    total = len(records)
    page_size = _to_int(request.args.get("page_size"), DEFAULT_PAGE_SIZE)
    page_size = min(max(page_size, 1), MAX_PAGE_SIZE)

    pages = (total + page_size - 1) // page_size or 1
    page = min(max(_to_int(request.args.get("page"), 1), 1), pages)
    start = (page - 1) * page_size

    return jsonify({
        "ok": True,
        "items": records[start:start + page_size],
        "total": total,
        "page": page,
        "pages": pages,
    })


@bp.route("/<record_id>", methods=["GET"])
def get_record(record_id):
    """单条记录详情，返回记录对象本身；不存在时返回 404"""
    for record in storage.load_all():
        if record.get("id") == record_id:
            return jsonify(record)
    return jsonify({"ok": False, "errors": ["记录不存在"]}), 404
