"""
routes/io.py — 导入导出路由（11号）

GET  /api/export?format=json|csv  导出全部记录（附件下载）
POST /api/import                  导入 JSON/CSV 文件（multipart/form-data, file 字段）
"""

import csv
import io
import json
from datetime import datetime

from flask import Blueprint, Response, request

import models
import storage

bp = Blueprint("io", __name__, url_prefix="/api")

# 导出 CSV 的列（表头与字段一一对应，导入时同样按此解析）
CSV_FIELDS = ["type", "category", "amount", "date", "note"]

# 兼容中文表头 / 中文类型取值
_HEADER_ALIAS = {
    "类型": "type", "类别": "category", "金额": "amount", "日期": "date", "备注": "note",
}
_TYPE_ALIAS = {"支出": "expense", "收入": "income"}

# 单条错误信息的最大收集条数，防止脏文件刷出几千条错误拖垮响应
_MAX_ERRORS = 50


# ────────────────────────── 导出 ──────────────────────────

@bp.route("/export", methods=["GET"])
def export_data():
    """
    导出数据
    Query: format=json|csv（默认 json）
    以附件形式下载，文件名带当天日期
    """
    fmt = (request.args.get("format") or "json").strip().lower()
    records = storage.load_all()
    stamp = datetime.now().strftime("%Y%m%d")

    if fmt == "json":
        payload = json.dumps(records, ensure_ascii=False, indent=2)
        return Response(
            payload,
            mimetype="application/json; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=bookkeeper_{stamp}.json"},
        )

    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
        # 加 BOM（utf-8-sig），保证 Excel 打开中文不乱码
        payload = "﻿" + buf.getvalue()
        return Response(
            payload,
            mimetype="text/csv; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename=bookkeeper_{stamp}.csv"},
        )

    return {"ok": False, "errors": [f"不支持的导出格式「{fmt}」，可选：json、csv"]}, 400


# ────────────────────────── 导入 ──────────────────────────

@bp.route("/import", methods=["POST"])
def import_data():
    """
    导入数据
    请求: multipart/form-data，字段名 file，支持 .json / .csv
    规则: 逐行校验（models.validate），重复记录跳过
          （同 type + category + amount + date 视为重复，与已有数据及文件内部比对）
    返回: {"ok": true, "imported": int, "skipped": int, "errors": [...]}
    """
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return {"ok": False, "errors": ["未收到文件，请通过 file 字段上传 .json 或 .csv 文件"]}, 400

    raw = upload.read()
    if not raw:
        return {"ok": False, "errors": ["文件内容为空"]}, 400

    try:
        text = raw.decode("utf-8-sig")  # 同时兼容带/不带 BOM 的 UTF-8
    except UnicodeDecodeError:
        return {"ok": False, "errors": ["文件编码不是 UTF-8，请另存为 UTF-8 后重试"]}, 400

    rows, parse_errors = _parse_rows(text, upload.filename)
    if rows is None:
        return {"ok": False, "errors": parse_errors}, 400

    return _merge_rows(rows, parse_errors)


# ────────────────────── 解析（内部） ──────────────────────

def _parse_rows(text: str, filename: str):
    """
    把文件文本解析成 list[dict]（每条为一个记录 payload）
    返回 (rows, errors)；格式无法识别时 rows 为 None
    """
    name = (filename or "").lower()
    stripped = text.lstrip()

    if name.endswith(".json") or stripped.startswith("[") or stripped.startswith("{"):
        return _parse_json_rows(text)
    if name.endswith(".csv"):
        return _parse_csv_rows(text), []
    return None, ["无法识别的文件格式，请上传 .json 或 .csv 文件"]


def _parse_json_rows(text: str):
    """解析 JSON：接受 Record 数组，或 {"records": [...]} 包装"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return None, [f"JSON 解析失败：第 {exc.lineno} 行，{exc.msg}"]

    if isinstance(data, dict) and isinstance(data.get("records"), list):
        data = data["records"]
    if not isinstance(data, list):
        return None, ["JSON 内容必须是记录数组（或 {\"records\": [...]}）"]

    rows = []
    for i, item in enumerate(data, start=1):
        if isinstance(item, dict):
            rows.append(item)
        else:
            rows.append({"__row_error__": f"第 {i} 条不是 JSON 对象"})
    return rows, []


def _parse_csv_rows(text: str) -> list[dict]:
    """解析 CSV：按表头映射字段，兼容中文表头与中文类型取值"""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return []

    # 表头标准化：strip + 中文别名映射
    header_map = {}
    for field in reader.fieldnames:
        key = (field or "").strip()
        header_map[field] = _HEADER_ALIAS.get(key, key.lower())

    rows = []
    for raw_row in reader:
        row = {}
        for raw_key, value in raw_row.items():
            if raw_key is None:  # 列数多于表头的脏行
                continue
            key = header_map.get(raw_key)
            if key in CSV_FIELDS and value is not None:
                row[key] = value.strip()
        record_type = row.get("type", "")
        row["type"] = _TYPE_ALIAS.get(record_type, record_type)
        rows.append(row)
    return rows


# ────────────────────── 合并入库（内部） ──────────────────────

def _dedupe_key(payload: dict) -> tuple:
    """重复判定键：同类型 + 同类别 + 同金额 + 同日期 视为重复"""
    try:
        amount = round(float(payload.get("amount") or 0), 2)
    except (TypeError, ValueError):
        amount = None
    return (payload.get("type"), payload.get("category"), amount, payload.get("date"))


def _merge_rows(rows: list[dict], errors: list[str]):
    """逐行校验 + 去重 + 一次性落库"""
    existing = storage.load_all()
    seen = {_dedupe_key(r) for r in existing}

    imported_records = []
    skipped = 0

    for index, row in enumerate(rows, start=1):
        if "__row_error__" in row:
            errors.append(row["__row_error__"])
            continue

        # 只保留业务字段，忽略导入文件里自带的 id / created_at（防伪造主键）
        payload = {k: row.get(k) for k in CSV_FIELDS}

        row_errors = models.validate(payload)
        if row_errors:
            errors.append(f"第 {index} 行：{'；'.join(row_errors)}")
            continue

        key = _dedupe_key(payload)
        if key in seen:
            skipped += 1
            continue

        seen.add(key)
        imported_records.append(models.new_record(payload))

        if len(errors) >= _MAX_ERRORS:
            errors.append(f"错误过多，仅展示前 {_MAX_ERRORS} 条，后续行已中止处理")
            break

    if imported_records:
        # 一次读改写，避免逐条 append 的 N 次 IO
        storage.save_all(existing + imported_records)

    return {
        "ok": True,
        "imported": len(imported_records),
        "skipped": skipped,
        "errors": errors,
    }
