"""
seed.py — 演示数据生成（11号）

生成 40 条近 3 个月的演示记录，覆盖全部支出/收入类别，
供 6/7/8/9 号统计与图表模块开发及最终演示使用。

用法：
    python seed.py            # 数据文件为空时写入演示数据
    python seed.py --force    # 强制覆盖已有数据
    python seed.py --count 60 # 自定义条数（默认 40）
"""

import argparse
import random
import sys
from datetime import date, datetime, timedelta, timezone

import models
import storage

# 固定随机种子：任何人生成的演示数据一致，便于团队协作与演示复现
RANDOM_SEED = 20261107

DAYS_SPAN = 90  # 近 3 个月

# ── 各类别的金额区间与备注池（贴近真实场景）──
_EXPENSE_PROFILES = {
    "饮食": ((5, 120), ["早餐豆浆油条", "公司楼下快餐", "周末聚餐", "奶茶一杯", "晚餐外卖", "水果"]),
    "交通": ((2, 80), ["地铁通勤", "打车回家", "公交卡充值", "共享单车月卡", "高铁票"]),
    "购物": ((30, 800), ["换季外套", "京东日用百货", "新鼠标", "运动鞋", "手机壳", "零食大礼包"]),
    "娱乐": ((15, 300), ["电影票", "视频网站会员", "Steam 游戏", "KTV 欢唱", "演唱会门票"]),
    "学习": ((20, 500), ["技术书籍", "在线课程", "考试报名费", "文具", "知识付费专栏"]),
    "居住": ((50, 2500), ["房租", "水电费", "燃气费", "宽带费", "物业公摊"]),
    "医疗": ((10, 400), ["感冒药", "门诊挂号", "体检套餐", "眼药水", "牙科洗牙"]),
    "其他": ((5, 200), ["快递费", "理发", "捐款", "打印资料", "宠物用品"]),
}

_INCOME_PROFILES = {
    "工资": ((8000, 12000), ["月度工资", "月度工资（含绩效）"]),
    "兼职": ((200, 2000), ["周末家教", "外包小程序尾款", "设计私单", "翻译稿费"]),
    "红包": ((20, 500), ["生日红包", "节日红包", "群红包手气最佳"]),
    "理财": ((50, 1500), ["基金分红", "余额宝收益", "股票卖出盈利", "国债逆回购利息"]),
    "其他": ((30, 800), ["闲置二手卖出", "报销到账", "退款", "副业收入"]),
}


def _random_date(rng: random.Random) -> date:
    """在近 90 天内随机取一天"""
    return date.today() - timedelta(days=rng.randint(0, DAYS_SPAN - 1))


def _build_payloads(count: int, rng: random.Random) -> list[dict]:
    """构造 count 条 payload，保证全部类别至少出现一次"""
    payloads: list[dict] = []

    def make(record_type: str, category: str) -> dict:
        (low, high), notes = (_EXPENSE_PROFILES if record_type == "expense" else _INCOME_PROFILES)[category]
        amount = round(rng.uniform(low, high), 2)
        return {
            "type": record_type,
            "category": category,
            "amount": amount,
            "date": _random_date(rng).isoformat(),
            "note": rng.choice(notes),
        }

    # 1) 每个类别至少一条（支出 8 + 收入 5 = 13 条）
    for category in models.EXPENSE_CATEGORIES:
        payloads.append(make("expense", category))
    for category in models.INCOME_CATEGORIES:
        payloads.append(make("income", category))

    # 2) 每月 1 号固定一条工资，保证时间维度统计有稳定收入基线
    today = date.today()
    for months_ago in range(3):
        first = (today.replace(day=1) - timedelta(days=months_ago * 30)).replace(day=1)
        salary = make("income", "工资")
        salary["date"] = first.isoformat()
        payloads.append(salary)

    # 3) 补足剩余条数，收支比例约 3:1
    while len(payloads) < count:
        if rng.random() < 0.75:
            payloads.append(make("expense", rng.choice(models.EXPENSE_CATEGORIES)))
        else:
            payloads.append(make("income", rng.choice(models.INCOME_CATEGORIES)))

    # 按日期排序，让数据看起来更像真实流水
    payloads.sort(key=lambda p: p["date"])
    return payloads[:count]


def generate_seed_data(count: int = 40) -> list[dict]:
    """
    生成 count 条演示记录（默认 40 条）
    - 覆盖所有支出/收入类别
    - 日期分布在近 3 个月，按日期升序
    - 通过 models.new_record 生成 id / created_at，金额两位小数
    """
    rng = random.Random(RANDOM_SEED)
    records: list[dict] = []

    for payload in _build_payloads(count, rng):
        # validate 兜底：种子数据必须 100% 通过校验
        errors = models.validate(payload)
        if errors:
            raise ValueError(f"种子数据校验失败：{errors}（payload={payload}）")
        record = models.new_record(payload)
        # created_at 与账单日期对齐（当天中午），比"全部生成于此刻"更真实
        bill_date = datetime.strptime(payload["date"], models.DATE_FORMAT)
        record["created_at"] = bill_date.replace(hour=12, tzinfo=timezone.utc).isoformat(timespec="seconds")
        records.append(record)

    return records


def main() -> int:
    parser = argparse.ArgumentParser(description="生成记账本演示数据")
    parser.add_argument("--count", type=int, default=40, help="生成条数（默认 40）")
    parser.add_argument("--force", action="store_true", help="数据文件非空时强制覆盖")
    args = parser.parse_args()

    existing = storage.load_all()
    if existing and not args.force:
        print(f"⚠️  {storage.DATA_FILE} 已有 {len(existing)} 条记录。")
        print("    如需覆盖请加 --force（旧数据将丢失）。")
        return 1

    records = generate_seed_data(args.count)
    storage.save_all(records)

    expense_count = sum(1 for r in records if r["type"] == "expense")
    income_count = len(records) - expense_count
    date_range = f"{records[0]['date']} ~ {records[-1]['date']}" if records else "-"
    # 按 (type, category) 组合统计：支出「其他」与收入「其他」是两个不同类别
    pairs = sorted({(r["type"], r["category"]) for r in records})
    pair_labels = "、".join(f"{models.TYPE_LABELS[t]}-{c}" for t, c in pairs)

    print(f"✅ 已写入 {len(records)} 条演示记录 → {storage.DATA_FILE}")
    print(f"   支出 {expense_count} 条 / 收入 {income_count} 条，日期范围 {date_range}")
    print(f"   覆盖类别组合（{len(pairs)}/13 个）：{pair_labels}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
