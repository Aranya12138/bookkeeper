
/**
 * stats-category.js — 按类别维度统计前端（7号）
 *
 * 分类占比条形列表 + Top N 排行
 * 提供图表数据给 9 号: [{label, value}]
 */

window.BookApp = window.BookApp || {};
window.BookApp.views = window.BookApp.views || {};

window.BookApp.views["stats-category"] = {
  render(container) {
    container.innerHTML = `
      <div class="card">
        <h2>🏷️ 分类统计</h2>

        <!-- 收支类型切换 -->
        <div style="display:flex; gap:10px; margin:15px 0;">
          <button id="category-expense" class="active">支出统计</button>
          <button id="category-income">收入统计</button>
        </div>

        <!-- 日期筛选 -->
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:15px;">
          <div>
            <label>开始日期</label>
            <input type="date" id="category-from">
          </div>
          <div>
            <label>结束日期</label>
            <input type="date" id="category-to">
          </div>
          <button id="category-search">查询</button>
        </div>

        <!-- 总金额 -->
        <div style="margin-bottom:20px;">
          <p style="color:#888; margin-bottom:5px;">统计总金额</p>
          <h2 id="category-total">¥0.00</h2>
        </div>

        <!-- 分类占比列表 -->
        <h3>📊 分类占比</h3>
        <div id="category-list">
          <p style="color:#888;">正在加载...</p>
        </div>

        <!-- Top N 排行 -->
        <h3 style="margin-top:25px;">🏆 Top 5 分类排行</h3>
        <div id="category-ranking"></div>
      </div>
    `;

    let currentType = "expense";
    let categoryData = [];

    const list = container.querySelector("#category-list");
    const ranking = container.querySelector("#category-ranking");
    const total = container.querySelector("#category-total");

    // 获取统计数据
    async function loadData() {
      const from = container.querySelector("#category-from").value;
      const to = container.querySelector("#category-to").value;

      if (from && to && from > to) {
        list.innerHTML = '<p style="color:red;">开始日期不能晚于结束日期</p>';
        return;
      }

      const params = new URLSearchParams({
        type: currentType
      });

      if (from) params.append("from", from);
      if (to) params.append("to", to);

      list.innerHTML = '<p style="color:#888;">正在加载...</p>';

      try {
        // 根据项目实际 API 地址调整
        const response = await fetch(
          `/api/stats/by-category?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error("获取分类统计数据失败");
        }

        categoryData = await response.json();

        renderData();

        // 提供图表数据给 9 号
        const chartData = categoryData.map(item => ({
          label: item.category,
          value: item.amount
        }));

        // 保存到全局对象，供其他模块调用
        window.BookApp.categoryChartData = chartData;

        // 如果项目存在统一图表事件，也可以通过事件通知 9 号
        window.dispatchEvent(new CustomEvent(
          "categoryStatsUpdated",
          { detail: chartData }
        ));

      } catch (error) {
        list.innerHTML = `
          <p style="color:red;">
            ${error.message || "数据加载失败，请稍后重试"}
          </p>
        `;
        ranking.innerHTML = "";
        total.textContent = "¥0.00";
      }
    }

    // 渲染统计结果
    function renderData() {
      const sum = categoryData.reduce(
        (acc, item) => acc + Number(item.amount || 0), 0
      );

      total.textContent = `¥${sum.toFixed(2)}`;

      if (categoryData.length === 0) {
        list.innerHTML = '<p style="color:#888;">暂无统计数据</p>';
        ranking.innerHTML = '<p style="color:#888;">暂无排行数据</p>';
        return;
      }

      // 分类占比条形列表
      list.innerHTML = categoryData.map(item => {
        const percent = Number(item.percent || 0);

        return `
          <div style="margin-bottom:16px;">
            <div style="
              display:flex;
              justify-content:space-between;
              margin-bottom:6px;
            ">
              <span>${escapeHTML(item.category || "未分类")}</span>
              <span>
                ¥${Number(item.amount).toFixed(2)}
                (${percent.toFixed(2)}%)
              </span>
            </div>

            <div style="
              width:100%;
              height:10px;
              background:#eee;
              border-radius:10px;
              overflow:hidden;
            ">
              <div style="
                width:${Math.max(0, Math.min(100, percent))}%;
                height:100%;
                background:#4f8cff;
                border-radius:10px;
              "></div>
            </div>

            <small style="color:#888;">
              ${Number(item.count || 0)} 笔交易
            </small>
          </div>
        `;
      }).join("");

      // Top 5 排行
      const topFive = [...categoryData]
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, 5);

      ranking.innerHTML = topFive.map((item, index) => `
        <div style="
          display:flex;
          justify-content:space-between;
          padding:10px;
          margin-bottom:8px;
          background:#f7f8fa;
          border-radius:8px;
        ">
          <span>
            ${["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][index]}
            ${escapeHTML(item.category || "未分类")}
          </span>
          <strong>¥${Number(item.amount).toFixed(2)}</strong>
        </div>
      `).join("");
    }

    // 防止类别名称中的 HTML 被执行
    function escapeHTML(value) {
      return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    }

    // 支出 / 收入切换
    container.querySelector("#category-expense")
      .addEventListener("click", () => {
        currentType = "expense";
        container.querySelector("#category-expense").classList.add("active");
        container.querySelector("#category-income").classList.remove("active");
        loadData();
      });

    container.querySelector("#category-income")
      .addEventListener("click", () => {
        currentType = "income";
        container.querySelector("#category-income").classList.add("active");
        container.querySelector("#category-expense").classList.remove("active");
        loadData();
      });

    // 查询按钮
    container.querySelector("#category-search")
      .addEventListener("click", loadData);

    // 首次加载
    loadData();
  }
};
