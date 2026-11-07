"""test_stats_amount.py — 金额维度统计测试（8号）

覆盖：
1. 日期筛选、汇总、max/min、Top5
2. 分布区间边界
3. 空数据
4. 非法日期 / 反向区间
5. 与 storage + seed.py 的真实集成（40 条演示数据）
"""

import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import seed
import storage
from app import create_app

CENT = Decimal("0.01")


@pytest.fixture
def client(tmp_path, monkeypatch):
    """每个测试使用独立的数据文件，避免污染 data/records.json。"""
    data_file = tmp_path / "data" / "records.json"
    monkeypatch.setattr(storage, "DATA_FILE", str(data_file))
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


@pytest.fixture
def records():
    return [
        {
            "id": "a",
            "type": "expense",
            "amount": 999,
            "category": "购物",
            "date": "2026-08-31",
            "note": "范围外",
        },
        {
            "id": "b",
            "type": "expense",
            "amount": 12.5,
            "category": "饮食",
            "date": "2026-09-01",
            "note": "早餐",
        },
        {
            "id": "c",
            "type": "income",
            "amount": 1000,
            "category": "工资",
            "date": "2026-09-15",
            "note": "九月工资",
        },
        {
            "id": "d",
            "type": "expense",
            "amount": 50,
            "category": "交通",
            "date": "2026-10-31",
            "note": "打车",
        },
        {
            "id": "e",
            "type": "expense",
            "amount": 2000,
            "category": "购物",
            "date": "2026-11-01",
            "note": "范围外",
        },
    ]


def test_filters_and_summary(client, records):
    storage.save_all(records)

    resp = client.get("/api/stats/by-amount?from=2026-09-01&to=2026-10-31")
    assert resp.status_code == 200
    data = resp.get_json()

    assert data["count"] == 3
    assert data["total"] == 1062.5
    assert data["avg"] == 354.17
    assert data["max"] == {
        "id": "c",
        "amount": 1000.0,
        "category": "工资",
        "date": "2026-09-15",
    }
    assert data["min"] == {
        "id": "b",
        "amount": 12.5,
        "category": "饮食",
        "date": "2026-09-01",
    }
    assert [row["id"] for row in data["top5"]] == ["c", "d", "b"]
    assert data["top5"][0]["note"] == "九月工资"


def test_distribution_boundaries(client):
    values = [49.99, 50, 99.99, 100, 199.99, 200, 499.99, 500, 999.99, 1000]
    storage.save_all([
        {
            "id": str(index),
            "type": "expense",
            "amount": value,
            "category": "其他",
            "date": "2026-10-01",
            "note": "",
        }
        for index, value in enumerate(values)
    ])

    data = client.get("/api/stats/by-amount").get_json()

    assert [item["bucket"] for item in data["distribution"]] == [
        "0-50",
        "50-100",
        "100-200",
        "200-500",
        "500-1000",
        "1000+",
    ]
    assert [item["count"] for item in data["distribution"]] == [1, 2, 2, 2, 2, 1]
    assert sum(item["count"] for item in data["distribution"]) == data["count"] == 10


def test_empty_data_returns_zeroes(client):
    storage.save_all([])

    data = client.get("/api/stats/by-amount").get_json()

    assert data["count"] == 0
    assert data["total"] == 0.0
    assert data["max"] is None
    assert data["min"] is None
    assert data["avg"] == 0.0
    assert data["top5"] == []
    assert len(data["distribution"]) == 6
    assert all(item["count"] == 0 for item in data["distribution"])


def test_invalid_date_and_reversed_range(client):
    bad = client.get("/api/stats/by-amount?from=2026-02-30")
    assert bad.status_code == 400
    assert bad.get_json()["ok"] is False
    assert "YYYY-MM-DD" in bad.get_json()["errors"][0]

    reversed_range = client.get(
        "/api/stats/by-amount?from=2026-10-01&to=2026-09-01"
    )
    assert reversed_range.status_code == 400
    assert reversed_range.get_json() == {"ok": False, "errors": ["from 不能晚于 to"]}


def test_seed_and_storage_integration(client):
    """40 条 seed 数据落库后，接口应完整统计，不依赖任何 mock。"""
    records = seed.generate_seed_data(40)
    storage.save_all(records)

    data = client.get("/api/stats/by-amount").get_json()

    assert data["count"] == 40
    assert sum(item["count"] for item in data["distribution"]) == 40
    assert len(data["top5"]) == 5

    expected_total = sum(
        (Decimal(str(record["amount"])) for record in records),
        Decimal("0"),
    ).quantize(CENT, rounding=ROUND_HALF_UP)
    assert data["total"] == float(expected_total)

    amounts = [record["amount"] for record in records]
    assert data["max"]["amount"] == max(amounts)
    assert data["min"]["amount"] == min(amounts)
    assert data["top5"][0]["amount"] == max(amounts)
    assert [row["amount"] for row in data["top5"]] == sorted(amounts, reverse=True)[:5]
