/**
 * stats-amount.js — 按金额维度统计前端（8号）
 *
 * 统计卡片 + 金额分布区间 + 最大 5 笔记录列表。
 * 给 9 号的柱状图数据：
 *   distribution.map(item => ({ label: item.bucket, value: item.count }))
 *
 * 依赖：
 *   - BookApp.api.get(path)      由 api.js 提供，path 不含 /api 前缀
 *   - BookApp.chart.bar(el, data) 由 chart.js 提供（未实现时自动降级）
 */

window.BookApp = window.BookApp || {};
window.BookApp.views = window.BookApp.views || {};

(function (App) {
  "use strict";

  const STYLE_ID = "stats-amount-style";

  const moneyFormatter = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }

  function money(value) {
    const number = Number(value);
    return "¥ " + moneyFormatter.format(Number.isFinite(number) ? number : 0);
  }

  function amountOf(value) {
    if (value && typeof value === "object") return Number(value.amount) || 0;
    return Number(value) || 0;
  }

  function typeLabel(type) {
    if (type === "income") return "收入";
    if (type === "expense") return "支出";
    return "其他";
  }

  function errorText(error) {
    if (error && Array.isArray(error.errors) && error.errors.length) {
      return error.errors.join("；");
    }
    if (error && error.message) return error.message;
    return "加载失败，请稍后重试";
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .sa-view { display: grid; gap: 16px; min-width: 0; }
      .sa-view .sa-head {
        display: flex; flex-wrap: wrap; align-items: flex-end;
        justify-content: space-between; gap: 12px; min-width: 0;
      }
      .sa-view .sa-head h2 { margin: 0; }
      .sa-sub { margin: 4px 0 0; color: #888; font-size: 13px; }
      .sa-filter { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; min-width: 0; }
      .sa-field { display: grid; min-width: 0; gap: 4px; color: #666; font-size: 12px; }
      .sa-field input {
        min-width: 0; min-height: 36px; padding: 6px 10px;
        border: 1px solid #d0d0d0; border-radius: 6px;
        background: #fff; color: #333; font: inherit;
      }
      .sa-field input:focus {
        outline: none; border-color: #4f46e5;
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
      }
      .sa-status { min-height: 20px; margin: 8px 0 4px; color: #888; font-size: 13px; }
      .sa-status.is-error { color: #ef4444; }
      .sa-cards { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
      .sa-cards .summary-card { padding: 16px 12px; }
      .sa-cards .summary-card .value { font-size: 20px; white-space: nowrap; line-height: 1.35; }
      .sa-cards .summary-card .label { white-space: nowrap; }
      .sa-card-sub {
        margin-top: 4px; color: #999; font-size: 11px; min-height: 16px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .sa-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; min-width: 0; }
      .sa-grid .card { margin-bottom: 0; min-width: 0; }
      .sa-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .sa-panel-head h2 { margin: 0; }
      .sa-hint { color: #999; font-size: 12px; }
      .sa-chart { display: block; padding: 12px; min-height: 260px; }
      .sa-bars { display: grid; gap: 10px; width: 100%; padding: 6px 4px; }
      .sa-bar-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) 34px; align-items: center; gap: 8px; font-size: 12px; }
      .sa-bar-label { color: #777; text-align: right; white-space: nowrap; }
      .sa-bar-track { height: 14px; overflow: hidden; border-radius: 999px; background: rgba(79, 70, 229, 0.12); }
      .sa-bar-fill { display: block; height: 100%; border-radius: inherit; background: #4f46e5; }
      .sa-bar-count { color: #555; text-align: right; font-variant-numeric: tabular-nums; }
      .sa-top { min-height: 260px; }
      .sa-table { font-size: 13px; }
      .sa-table th, .sa-table td { padding: 8px 8px; white-space: nowrap; }
      .sa-table td:last-child { color: #777; white-space: normal; }
      .sa-money { white-space: nowrap; font-variant-numeric: tabular-nums; }
      .sa-tag { display: inline-block; padding: 1px 6px; border-radius: 999px; background: #f0f0f0; color: #666; font-size: 11px; }
      @media (max-width: 760px) {
        .sa-grid { grid-template-columns: minmax(0, 1fr); }
      }
      @media (max-width: 640px) {
        .sa-view .sa-head { align-items: stretch; flex-direction: column; }
        .sa-filter { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; }
        .sa-filter .btn { width: 100%; }
        .sa-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .sa-field input { width: 100%; box-sizing: border-box; }
      }
      @media (max-width: 380px) {
        .sa-cards { grid-template-columns: minmax(0, 1fr); }
      }
    `;
    document.head.appendChild(style);
  }

  function card(label, value, sub) {
    return `
      <div class="summary-card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
        <div class="sa-card-sub">${escapeHtml(sub || "")}</div>
      </div>
    `;
  }

  function template() {
    return `
      <section class="sa-view" aria-labelledby="sa-amount-title">
        <div class="card">
          <div class="sa-head">
            <div>
              <h2 id="sa-amount-title">💰 金额分析</h2>
              <p class="sa-sub">按金额区间看结构，并找出最大 5 笔</p>
            </div>
            <form class="sa-filter" data-sa-form>
              <label class="sa-field">开始日期<input type="date" name="from" /></label>
              <label class="sa-field">结束日期<input type="date" name="to" /></label>
              <button class="btn btn-primary" type="submit" data-sa-submit>查询</button>
              <button class="btn btn-secondary" type="button" data-sa-reset>重置</button>
            </form>
          </div>

          <div class="sa-status" data-sa-status role="status" aria-live="polite"></div>

          <div class="summary-cards sa-cards" data-sa-cards>
            ${card("总金额", "—")}
            ${card("笔数", "—")}
            ${card("平均每笔", "—")}
            ${card("最大单笔", "—")}
            ${card("最小单笔", "—")}
          </div>
        </div>

        <div class="sa-grid">
          <div class="card">
            <div class="sa-panel-head">
              <h2>金额分布</h2>
              <span class="sa-hint">按笔数</span>
            </div>
            <div class="chart-box sa-chart" data-sa-chart>
              <div class="empty-state"><p>加载中…</p></div>
            </div>
          </div>

          <div class="card">
            <div class="sa-panel-head">
              <h2>最大 5 笔</h2>
              <span class="sa-hint">金额降序</span>
            </div>
            <div class="sa-top" data-sa-top>
              <div class="empty-state"><p>加载中…</p></div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderCards(root, data) {
    const max = data && data.max;
    const min = data && data.min;
    const maxSub = max && typeof max === "object"
      ? [max.category, max.date].filter(Boolean).join(" · ")
      : "";
    const minSub = min && typeof min === "object"
      ? [min.category, min.date].filter(Boolean).join(" · ")
      : "";

    root.innerHTML = [
      card("总金额", money(data && data.total)),
      card("笔数", String(Number(data && data.count) || 0)),
      card("平均每笔", money(data && data.avg)),
      card("最大单笔", money(amountOf(max)), maxSub),
      card("最小单笔", money(amountOf(min)), minSub),
    ].join("");
  }

  function renderChart(root, distribution) {
    const rows = Array.isArray(distribution) ? distribution : [];
    const total = rows.reduce(function (sum, item) {
      return sum + (Number(item.count) || 0);
    }, 0);

    if (!rows.length || total === 0) {
      root.innerHTML = '<div class="empty-state"><p>暂无金额分布数据</p></div>';
      return;
    }

    const chartData = rows.map(function (item) {
      return { label: String(item.bucket), value: Number(item.count) || 0 };
    });

    // 9 号的 Chart.bar(el, [{label, value}])；尚未实现时自动降级。
    const chart = App.chart;
    if (chart && typeof chart.bar === "function") {
      try {
        root.innerHTML = "";
        chart.bar(root, chartData);
        if (root.childElementCount > 0 || root.textContent.trim()) return;
      } catch (error) {
        if (window.console) console.warn("[stats-amount] Chart.bar 渲染失败", error);
      }
    }

    const max = Math.max.apply(null, chartData.map(function (item) { return item.value; }).concat([1]));
    root.innerHTML = '<div class="sa-bars">' + chartData.map(function (item) {
      const percent = Math.round((item.value / max) * 100);
      return `
        <div class="sa-bar-row">
          <span class="sa-bar-label">${escapeHtml(item.label)}</span>
          <span class="sa-bar-track"><i class="sa-bar-fill" style="width:${percent}%"></i></span>
          <span class="sa-bar-count">${item.value}</span>
        </div>
      `;
    }).join("") + "</div>";
  }

  function renderTop5(root, items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      root.innerHTML = '<div class="empty-state"><p>暂无记录</p></div>';
      return;
    }

    root.innerHTML = `
      <div class="table-wrap">
        <table class="sa-table">
          <thead>
            <tr><th>日期</th><th>类别</th><th>金额</th><th>备注</th></tr>
          </thead>
          <tbody>
            ${rows.map(function (row) {
              const type = row.type === "income" ? "income" : "expense";
              const sign = row.type === "income" ? "+" : (row.type === "expense" ? "-" : "");
              return `
                <tr title="${escapeHtml(typeLabel(row.type))}">
                  <td>${escapeHtml(row.date || "")}</td>
                  <td>${escapeHtml(row.category || "")}</td>
                  <td class="sa-money amount-${type}">${sign}${money(row.amount)}</td>
                  <td>${escapeHtml(row.note || "—")}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function render(container) {
    if (!container) throw new Error("stats-amount.render 需要容器元素");
    ensureStyle();
    container.innerHTML = template();

    const form = container.querySelector("[data-sa-form]");
    const fromInput = form.elements.from;
    const toInput = form.elements.to;
    const submitButton = container.querySelector("[data-sa-submit]");
    const resetButton = container.querySelector("[data-sa-reset]");
    const statusBox = container.querySelector("[data-sa-status]");
    const cardsBox = container.querySelector("[data-sa-cards]");
    const chartBox = container.querySelector("[data-sa-chart]");
    const topBox = container.querySelector("[data-sa-top]");

    let requestId = 0;

    function setStatus(message, isError) {
      statusBox.textContent = message || "";
      statusBox.classList.toggle("is-error", Boolean(isError));
    }

    async function load() {
      const current = ++requestId;
      const params = new URLSearchParams();
      if (fromInput.value) params.set("from", fromInput.value);
      if (toInput.value) params.set("to", toInput.value);

      setStatus("加载中…", false);
      submitButton.disabled = true;

      try {
        if (!App.api || typeof App.api.get !== "function") {
          throw new Error("BookApp.api.get 未加载，请检查 api.js 的引入顺序");
        }
        const query = params.toString();
        // api.js 内部已经拼接 /api，这里不要再写 /api
        const data = await App.api.get("/stats/by-amount" + (query ? "?" + query : ""));
        if (current !== requestId) return;

        renderCards(cardsBox, data || {});
        renderChart(chartBox, (data && data.distribution) || []);
        renderTop5(topBox, (data && data.top5) || []);
        setStatus("", false);
      } catch (error) {
        if (current !== requestId) return;
        setStatus(errorText(error), true);
        if (cardsBox.textContent.indexOf("—") !== -1) {
          renderCards(cardsBox, {});
        }
        if (chartBox.textContent.indexOf("加载中") !== -1) {
          chartBox.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
        }
        if (topBox.textContent.indexOf("加载中") !== -1) {
          topBox.innerHTML = '<div class="empty-state"><p>加载失败</p></div>';
        }
      } finally {
        if (current === requestId) submitButton.disabled = false;
      }
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (fromInput.value && toInput.value && fromInput.value > toInput.value) {
        setStatus("开始日期不能晚于结束日期", true);
        return;
      }
      load();
    });

    resetButton.addEventListener("click", function () {
      form.reset();
      load();
    });

    load();
  }

  App.views["stats-amount"] = { render: render };
})(window.BookApp);
