"""
models.py — 数据模型与校验（3号）
负责 Record 的创建、校验、枚举定义

Record 结构（与 CONTRACT.md 一致）：
{
    "id": "UUID4 字符串",              # new_record() 自动生成
    "type": "expense" | "income",
    "category": "饮食",
    "amount": 12.34,                   # 数字，保留两位小数
    "date": "2026-11-07",              # YYYY-MM-DD
    "note": "午饭",                    # 可选，≤100 字
    "created_at": "2026-11-07T07:00:00+00:00",  # new_record() 自动生成
}
"""

import math
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

# ── 类别枚举 ──
# 支出 8 类；收入 5 类（按 3 号任务卡：工资/兼职/红包/理财/其他）
EXPENSE_CATEGORIES = ["饮食", "交通", "购物", "娱乐", "学习", "居住", "医疗", "其他"]
INCOME_CATEGORIES = ["工资", "兼职", "红包", "理财", "其他"]

ALL_CATEGORIES = {
    "expense": EXPENSE_CATEGORIES,
    "income": INCOME_CATEGORIES,
}

TYPE_LABELS = {"expense": "支出", "income": "收入"}

DATE_FORMAT = "%Y-%m-%d"
NOTE_MAX_LEN = 100

# 金额以“分”为单位四舍五入，避免二进制浮点带来的 2.675 → 2.67 问题
_CENT = Decimal("0.01")


def new_record(payload: dict) -> dict:
    """
    从用户数据创建完整记录对象
    - 自动生成 id (UUID4)
    - 自动生成 created_at (ISO 8601, UTC)
    - 金额保留两位小数（四舍五入）
    - 备注缺省为空字符串，并去掉首尾空白
    - 返回 dict

    注意：调用前应先通过 validate()；payload 里自带的 id / created_at
    会被忽略，防止前端伪造主键或创建时间。
    """
    if not isinstance(payload, dict):
        raise TypeError("payload 必须是 dict")

    note = payload.get("note", "")
    if not isinstance(note, str):
        note = ""
    note = note.strip()

    return {
        "id": str(uuid.uuid4()),
        "type": payload.get("type"),
        "category": payload.get("category"),
        "amount": _round_amount(payload.get("amount")),
        "date": payload.get("date"),
        "note": note,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def validate(payload: dict) -> list[str]:
    """
    校验记录数据
    - type 必须为 expense 或 income
    - amount 必须 >0
    - date 必须为 YYYY-MM-DD 格式且是真实存在的日期
    - category 必须在对应枚举中
    - note 不超过 100 字
    - 返回中文错误列表，无错误时返回 []

    说明：PUT 更新时请先把 patch 合并进原记录再调用本函数，
    因为这里的校验针对“完整记录”。
    """
    if not isinstance(payload, dict):
        return ["数据格式错误：请求体必须是 JSON 对象"]

    errors: list[str] = []

    # ── 类型 ──
    record_type = payload.get("type")
    if record_type is None or (isinstance(record_type, str) and not record_type.strip()):
        errors.append("类型不能为空，必须为 expense（支出）或 income（收入）")
        record_type = None
    elif not isinstance(record_type, str):
        errors.append("类型必须为字符串：expense（支出）或 income（收入）")
        record_type = None
    elif record_type not in ALL_CATEGORIES:
        errors.append(f"类型「{record_type}」不合法，必须为 expense（支出）或 income（收入）")
        record_type = None

    # ── 金额 ──
    raw_amount = payload.get("amount")
    if raw_amount is None or (isinstance(raw_amount, str) and not raw_amount.strip()):
        errors.append("金额不能为空")
    else:
        amount = _parse_amount(raw_amount)
        if amount is None:
            errors.append("金额必须为数字")
        elif amount <= 0:
            errors.append("金额必须大于 0")

    # ── 日期 ──
    raw_date = payload.get("date")
    if raw_date is None or (isinstance(raw_date, str) and not raw_date.strip()):
        errors.append("日期不能为空")
    elif not isinstance(raw_date, str) or not _is_iso_date(raw_date.strip()):
        errors.append("日期格式必须为 YYYY-MM-DD 且为有效日期（如 2026-11-07）")

    # ── 类别 ──
    category = payload.get("category")
    if category is None or (isinstance(category, str) and not category.strip()):
        errors.append("类别不能为空")
    elif not isinstance(category, str):
        errors.append("类别必须为字符串")
    elif record_type is not None and category not in ALL_CATEGORIES[record_type]:
        options = "、".join(ALL_CATEGORIES[record_type])
        errors.append(f"类别「{category}」不属于{TYPE_LABELS[record_type]}，可选：{options}")

    # ── 备注（可选）──
    note = payload.get("note")
    if note is not None and not isinstance(note, str):
        errors.append("备注必须为字符串")
    elif isinstance(note, str) and len(note.strip()) > NOTE_MAX_LEN:
        errors.append(f"备注不能超过 {NOTE_MAX_LEN} 字（当前 {len(note.strip())} 字）")

    return errors


# ── 内部工具 ──

def _round_amount(value) -> float:
    """把金额转成保留两位小数的 float（四舍五入）"""
    amount = _parse_amount(value)
    if amount is None:
        raise ValueError(f"金额格式非法：{value!r}")
    try:
        rounded = amount.quantize(_CENT, rounding=ROUND_HALF_UP)
    except InvalidOperation as exc:
        # 超大数字等极端输入，转成明确的 ValueError 方便路由层兜底
        raise ValueError(f"金额格式非法：{value!r}") from exc
    return float(rounded)


def _parse_amount(value):
    """
    把金额解析为 Decimal；无法解析时返回 None
    - 接受 int / float / 数字字符串（兼容表单与 CSV 导入）
    - 拒绝 bool、NaN、Infinity
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value if value.is_finite() else None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        # 用 str 转换，让 Decimal 拿到人看到的十进制字面量
        return Decimal(str(value))
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = Decimal(text)
        except (InvalidOperation, ValueError):
            return None
        return parsed if parsed.is_finite() else None
    return None


def _is_iso_date(value: str) -> bool:
    """
    判断是否为严格的 YYYY-MM-DD 有效日期
    strptime 会接受 2026-1-1 这类未补零写法，因此回写格式化后再比对一次
    """
    try:
        parsed = datetime.strptime(value, DATE_FORMAT)
    except ValueError:
        return False
    return parsed.strftime(DATE_FORMAT) == value
