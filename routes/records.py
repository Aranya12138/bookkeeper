"""
routes/records.py — 记账模块路由（4号）
POST   /api/records          — 新增记录（校验 → 落库 → 201）
PUT    /api/records/<id>     — 更新记录（部分或全部字段）
DELETE /api/records/<id>     — 删除记录

错误统一格式：{"ok": false, "errors": ["..."]}
"""

from flask import Blueprint, jsonify, request

import storage
from models import new_record, validate

bp = Blueprint("records", __name__, url_prefix="/api/records")


# ── 辅助函数 ──

def _json_error(message, status=400):
    """统一错误响应，保证与 CONTRACT.md 约定的格式一致"""
    return jsonify({"ok": False, "errors": [message]}), status


def _get_json_body():
    """读取请求体 JSON；请求体不是 JSON 对象时返回 None"""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else None


def _find_record(record_id):
    """按 id 查找记录，不存在返回 None"""
    for record in storage.load_all():
        if record.get("id") == record_id:
            return record
    return None


def _normalize_update(existing, merged):
    """
    复用 new_record 的规范化逻辑（金额保留两位小数、备注去首尾空白），
    但保留原 id 与 created_at —— 更新不改变这两者。
    """
    normalized = new_record(merged)
    normalized["id"] = existing["id"]
    normalized["created_at"] = existing.get("created_at")
    return normalized


# ── 路由 ──

@bp.route("", methods=["POST"])
def create_record():
    """
    新增一条记录
    请求体: {type, category, amount, date, note?}
    成功: 201 {"ok": true, "record": {...}}
    失败: 400 {"ok": false, "errors": [...]}
    """
    payload = _get_json_body()
    if payload is None:
        return _json_error("请求体必须是 JSON 对象")

    errors = validate(payload)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    record = new_record(payload)
    storage.append(record)
    return jsonify({"ok": True, "record": record}), 201


@bp.route("/<record_id>", methods=["PUT"])
def update_record(record_id):
    """
    更新记录（部分或全部字段）
    请求体: 部分或全部字段，如 {"amount": 20, "note": "..."}
    成功: {"ok": true, "record": {...}}
    失败: 400（校验失败）/ 404（不存在）
    """
    payload = _get_json_body()
    if payload is None:
        return _json_error("请求体必须是 JSON 对象")

    existing = _find_record(record_id)
    if existing is None:
        return _json_error("记录不存在", 404)

    # 合并补丁；id / created_at 由服务端控制，忽略客户端传入值
    merged = {**existing, **payload}
    merged.pop("id", None)
    merged.pop("created_at", None)

    errors = validate(merged)
    if errors:
        return jsonify({"ok": False, "errors": errors}), 400

    normalized = _normalize_update(existing, merged)
    storage.update(record_id, normalized)
    return jsonify({"ok": True, "record": normalized})


@bp.route("/<record_id>", methods=["DELETE"])
def delete_record(record_id):
    """
    删除记录
    成功: {"ok": true}
    失败: 404（不存在）
    """
    if not storage.delete(record_id):
        return _json_error("记录不存在", 404)
    return jsonify({"ok": True})
