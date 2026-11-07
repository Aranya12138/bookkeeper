"""test_models.py — 模型校验测试（3号）

覆盖：
1. new_record 正确生成 id、created_at，金额保留两位小数
2. validate 合法数据返回 []
3. validate 非法数据返回对应中文错误
4. 类别与收支类型必须匹配、备注长度边界、多错误聚合
"""

import sys
import uuid
from datetime import datetime
from pathlib import Path

import pytest

# 保证直接运行 pytest 时也能导入项目根目录下的 models
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import (
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
    NOTE_MAX_LEN,
    new_record,
    validate,
)


def valid_payload(**overrides):
    """构造一条合法记录，可按键覆盖"""
    payload = {
        "type": "expense",
        "category": "饮食",
        "amount": 12.5,
        "date": "2026-11-07",
        "note": "午饭",
    }
    payload.update(overrides)
    return payload


class TestNewRecord:
    """new_record 创建逻辑测试"""

    def test_new_record_fields(self):
        """测试：new_record 自动生成 id、created_at，字段完整且金额保留两位小数"""
        record = new_record(valid_payload(amount=12.345))

        # id 是合法的 UUID4
        parsed_id = uuid.UUID(record["id"])
        assert parsed_id.version == 4

        # created_at 是可解析的 ISO 8601 时间
        assert datetime.fromisoformat(record["created_at"])

        # 原字段被正确带入
        assert record["type"] == "expense"
        assert record["category"] == "饮食"
        assert record["date"] == "2026-11-07"
        assert record["note"] == "午饭"

        # 金额四舍五入到两位小数
        assert record["amount"] == 12.35

    def test_new_record_generates_unique_ids(self):
        """测试：两次创建得到的 id 不重复"""
        assert new_record(valid_payload())["id"] != new_record(valid_payload())["id"]

    def test_new_record_ignores_payload_id_and_created_at(self):
        """测试：payload 自带的 id / created_at 不能覆盖自动生成的值"""
        record = new_record(
            valid_payload(id="fake-id", created_at="2000-01-01T00:00:00")
        )
        assert record["id"] != "fake-id"
        assert record["created_at"] != "2000-01-01T00:00:00"

    @pytest.mark.parametrize(
        "raw, expected",
        [
            (12.345, 12.35),   # 四舍五入
            (12.344, 12.34),
            (0.015, 0.02),
            (10, 10.0),        # 整数补成浮点
            ("3.333", 3.33),   # 兼容数字字符串（表单 / CSV）
        ],
    )
    def test_new_record_amount_two_decimals(self, raw, expected):
        """测试：不同来源的金额都被规范成两位小数"""
        assert new_record(valid_payload(amount=raw))["amount"] == expected

    def test_new_record_default_note(self):
        """测试：备注缺省为空字符串，首尾空白被清理"""
        payload = valid_payload()
        del payload["note"]
        assert new_record(payload)["note"] == ""
        assert new_record(valid_payload(note="  午饭  "))["note"] == "午饭"


class TestValidate:
    """validate 校验逻辑测试"""

    def test_validate_valid(self):
        """测试：合法数据 validate 返回 []"""
        assert validate(valid_payload()) == []

    @pytest.mark.parametrize("category", EXPENSE_CATEGORIES)
    def test_validate_all_expense_categories(self, category):
        """测试：支出类别枚举中的每一项都合法"""
        assert validate(valid_payload(category=category)) == []

    @pytest.mark.parametrize("category", INCOME_CATEGORIES)
    def test_validate_all_income_categories(self, category):
        """测试：收入类别枚举中的每一项都合法（含“红包”）"""
        assert validate(valid_payload(type="income", category=category)) == []

    def test_validate_note_optional_and_boundary(self):
        """测试：备注可不填；正好 100 字合法，101 字报错"""
        payload = valid_payload()
        del payload["note"]
        assert validate(payload) == []

        assert validate(valid_payload(note="备" * NOTE_MAX_LEN)) == []
        errors = validate(valid_payload(note="备" * (NOTE_MAX_LEN + 1)))
        assert any("备注" in e for e in errors)

    def test_validate_non_dict(self):
        """测试：请求体不是对象时返回中文错误而不是崩溃"""
        for payload in (None, [], "x", 123):
            errors = validate(payload)
            assert errors and "数据格式" in errors[0]

    def test_validate_invalid_type(self):
        """测试：非法 type 返回中文错误"""
        for bad_type in ("transfer", "", "expense "):
            errors = validate(valid_payload(type=bad_type))
            assert any("类型" in e for e in errors), bad_type

    def test_validate_invalid_amount(self):
        """测试：金额为空 / 非数字 / ≤0 时均报错"""
        for bad_amount in (None, 0, -1, "abc", "", True, float("nan"), float("inf")):
            errors = validate(valid_payload(amount=bad_amount))
            assert any("金额" in e for e in errors), bad_amount

    def test_validate_invalid_date(self):
        """测试：非法日期格式或无效日期均报错"""
        for bad_date in ("2026/11/07", "2026-1-1", "2026-02-30", "", None, 20261107):
            errors = validate(valid_payload(date=bad_date))
            assert any("日期" in e for e in errors), bad_date

    def test_validate_category_must_match_type(self):
        """测试：类别必须属于对应收支类型"""
        # 支出不能选收入类别
        assert any(
            "类别" in e
            for e in validate(valid_payload(type="expense", category="工资"))
        )
        # 收入不能选支出类别
        assert any(
            "类别" in e
            for e in validate(valid_payload(type="income", category="饮食"))
        )
        # 不存在的类别
        assert any(
            "类别" in e
            for e in validate(valid_payload(category="不存在的类别"))
        )

    def test_validate_collects_multiple_errors(self):
        """测试：多个字段同时出错时一次性返回全部错误"""
        errors = validate(
            {
                "type": "bad",
                "amount": -1,
                "date": "x",
                "category": None,
                "note": 123,
            }
        )
        assert len(errors) == 5
        # 错误信息都是给用户看的中文
        assert all(isinstance(e, str) and e for e in errors)
