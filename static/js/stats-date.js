/**
 * stats-date.js — 按时间维度统计前端（6号）
 *
 * 功能：粒度切换（日/周/月）+ 日期范围 + 三张汇总卡片（总收入/总支出/结余）+ 周期明细表。
 * 同时把每个周期的支出整理成 chartData（[{label, value}]）输出给 9 号图表模块。
 *
 * 依赖：
 *   window.BookApp.api.get    — 请求 GET /api/stats/by-date
 *   window.BookApp.chart.bar  — （可选）9 号实现后自动绘制支出趋势
 *
 * DOM 约定（本模块 render 时自行生成，与约定 ID 保持一致）：
 *   select#granularity  input#date-from  input#date-to
 *   #card-income  #card-expense  #card-balance
 *   #date-table  #chart-expense
 */

(function () {
  "use strict";

  // 粒度选项，与后端 GRANULARITIES 保持一致
  var GRANULARITIES = [
    { value: "day", label: "按日" },
    { value: "week", label: "按周" },
    { value: "month", label: "按月" },
  ];

  // 输出给 9 号图表模块的数据：每个周期的支出 [{label: period, value: expense}]
  var chartData = [];

  /** HTML 转义，防止拼接 innerHTML 时注入 */
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function $(id) {
    return document.getElementById(id);
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  /** 今天，格式 YYYY-MM-DD */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** 当月第一天 YYYY-MM-DD，作为默认起始日期 */
  function firstDayOfMonth() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-01";
  }

  /** 金额格式化：负数显示为 -¥xx.xx */
  function money(value) {
    var n = Number(value) || 0;
    var sign = n < 0 ? "-" : "";
    return sign + "¥" + Math.abs(n).toFixed(2);
  }

  /** 读取筛选栏当前值 */
  function readFilters() {
    return {
      granularity: $("granularity") ? $("granularity").value : "day",
      from: $("date-from") ? $("date-from").value : "",
      to: $("date-to") ? $("date-to").value : "",
    };
  }

  /** 拼接查询参数，空值不传（后端会对缺失参数报错） */
  function buildQuery() {
    var params = new URLSearchParams();
    var filters = readFilters();
    if (filters.granularity) params.set("granularity", filters.granularity);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    return params.toString();
  }

  /** 渲染三张汇总卡片：整个区间的合计 */
  function renderCards(items) {
    var incomeEl = $("card-income");
    if (!incomeEl) return; // 视图已切换，DOM 已销毁

    var income = 0;
    var expense = 0;
    items.forEach(function (r) {
      income += Number(r.income) || 0;
      expense += Number(r.expense) || 0;
    });
    var balance = income - expense;

    incomeEl.textContent = money(income);
    $("card-expense").textContent = money(expense);

    // 结余正负着色：正绿负红，与明细表一致
    var balanceEl = $("card-balance");
    balanceEl.textContent = money(balance);
    balanceEl.className = "value " + (balance < 0 ? "amount-expense" : "amount-income");
  }

  /** 渲染周期明细表 */
  function renderTable(items) {
    var table = $("date-table");
    if (!table) return;

    if (!items.length) {
      table.innerHTML = '<div class="empty-state"><p>该时间范围内暂无数据</p></div>';
      return;
    }

    var rows = items.map(function (r) {
      var balanceClass = Number(r.balance) < 0 ? "amount-expense" : "amount-income";
      return (
        "<tr>" +
        "<td>" + esc(r.period) + "</td>" +
        '<td class="amount-income">' + money(r.income) + "</td>" +
        '<td class="amount-expense">' + money(r.expense) + "</td>" +
        '<td class="' + balanceClass + '">' + money(r.balance) + "</td>" +
        "</tr>"
      );
    }).join("");

    table.innerHTML =
      '<div class="table-wrap"><table>' +
      "<thead><tr><th>周期</th><th>收入</th><th>支出</th><th>结余</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table></div>";
  }

  /** 输出图表数据并交给 9 号图表模块绘制 */
  function renderChart(items) {
    // 输出格式约定：[{label: period, value: expense}]
    chartData = items.map(function (r) {
      return { label: r.period, value: Number(r.expense) || 0 };
    });

    // 挂到全局命名空间，供 9 号按需读取
    window.BookApp.statsDate = window.BookApp.statsDate || {};
    window.BookApp.statsDate.chartData = chartData;

    // 若 9 号 chart 模块已加载，直接绘制支出趋势；未加载则静默跳过
    var chartEl = document.getElementById("chart-expense");
    if (chartEl && window.BookApp.chart && typeof window.BookApp.chart.bar === "function") {
      window.BookApp.chart.bar("#chart-expense", chartData);
    }
  }

  /** 请求接口并刷新界面 */
  function load() {
    var table = $("date-table");
    if (!table) return; // 视图已切换

    table.innerHTML = '<div class="empty-state"><p>加载中…</p></div>';

    var query = buildQuery();
    if (!query) {
      table.innerHTML = '<div class="empty-state"><p>请选择日期范围</p></div>';
      return;
    }

    window.BookApp.api
      .get("/stats/by-date?" + query)
      .then(function (data) {
        var items = Array.isArray(data) ? data : [];
        renderCards(items);
        renderTable(items);
        renderChart(items);
      })
      .catch(function (err) {
        if (!table) return;
        table.innerHTML =
          '<div class="empty-state"><p>加载失败：' +
          esc((err && err.message) || "未知错误") +
          "</p></div>";
      });
  }

  /** 视图入口（app.js 调度 render(container)） */
  function render(container) {
    container.innerHTML =
      '<div class="card">' +
      "  <h2>📊 时间统计</h2>" +
      '  <div class="filter-bar">' +
      '    <select id="granularity">' +
      GRANULARITIES.map(function (g) {
        return '<option value="' + g.value + '">' + g.label + "</option>";
      }).join("") +
      "    </select>" +
      '    <input type="date" id="date-from" title="开始日期">' +
      '    <input type="date" id="date-to" title="结束日期">' +
      "  </div>" +
      "</div>" +

      '<div class="summary-cards">' +
      '  <div class="summary-card"><div class="label">总收入</div><div class="value amount-income" id="card-income">¥0.00</div></div>' +
      '  <div class="summary-card"><div class="label">总支出</div><div class="value amount-expense" id="card-expense">¥0.00</div></div>' +
      '  <div class="summary-card"><div class="label">总结余</div><div class="value amount-income" id="card-balance">¥0.00</div></div>' +
      "</div>" +

      '<div class="card">' +
      "  <h2>📈 支出趋势</h2>" +
      '  <div class="chart-box" id="chart-expense"></div>' +
      "</div>" +

      '<div class="card">' +
      "  <h2>📋 周期明细</h2>" +
      '  <div id="date-table"></div>' +
      "</div>";

    // 默认粒度=日，日期范围=当月 1 号 ~ 今天
    $("granularity").value = "day";
    $("date-from").value = firstDayOfMonth();
    $("date-to").value = today();

    // 监听下拉、日期变化，自动重新请求刷新数据
    $("granularity").addEventListener("change", load);
    $("date-from").addEventListener("change", load);
    $("date-to").addEventListener("change", load);

    load();
  }

  window.BookApp = window.BookApp || {};
  window.BookApp.views = window.BookApp.views || {};
  window.BookApp.views["stats-date"] = { render: render };

  // 图表数据出口，初始为空，每次 load 成功后更新
  window.BookApp.statsDate = window.BookApp.statsDate || {};
  window.BookApp.statsDate.chartData = chartData;
})();
