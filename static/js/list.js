/**
 * list.js — 查看模块前端
 *
 * 明细页：筛选栏（类型 / 类别 / 日期范围 / 关键字）、分页表格、
 * 空状态、删除二次确认。默认显示最近 10 笔。
 *
 * 依赖 window.BookApp 上的 api、showToast、editRecord 以及 views 注册表。
 */
(function () {
  "use strict";

  // 类别枚举与 models.py 中的 EXPENSE_CATEGORIES / INCOME_CATEGORIES 保持一致
  var EXPENSE_CATEGORIES = ["饮食", "交通", "购物", "娱乐", "学习", "居住", "医疗", "其他"];
  var INCOME_CATEGORIES = ["工资", "兼职", "红包", "理财", "其他"];

  // 视图内部状态，切换视图后回来仍停留在原来那一页
  var state = { page: 1, pageSize: 10, pages: 1, total: 0 };

  /** HTML 转义，备注是用户输入，拼进 innerHTML 前必须先转义 */
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  /** 按类型取可选类别；不限类型时取并集，并用 Set 去掉重复的「其他」 */
  function categoriesFor(type) {
    if (type === "expense") return EXPENSE_CATEGORIES;
    if (type === "income") return INCOME_CATEGORIES;
    return Array.from(new Set(EXPENSE_CATEGORIES.concat(INCOME_CATEGORIES)));
  }

  function $(id) {
    return document.getElementById(id);
  }

  /** 读取筛选栏当前值 */
  function readFilters() {
    return {
      type: $("f-type") ? $("f-type").value : "",
      category: $("f-category") ? $("f-category").value : "",
      date_from: $("f-from") ? $("f-from").value : "",
      date_to: $("f-to") ? $("f-to").value : "",
      q: $("f-q") ? $("f-q").value.trim() : "",
    };
  }

  /** 拼接查询参数，空值不传 */
  function buildQuery() {
    var params = new URLSearchParams();
    var filters = readFilters();

    Object.keys(filters).forEach(function (key) {
      if (filters[key]) params.set(key, filters[key]);
    });

    params.set("sort", "date_desc");
    params.set("page", state.page);
    params.set("page_size", state.pageSize);

    return params.toString();
  }

  /** 拉取数据并渲染表格与分页器 */
  function load() {
    var tbody = $("list-body");
    if (!tbody) return; // 视图已切换，当前 DOM 不再更新

    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">加载中…</td></tr>';

    window.BookApp.api
      .get("/records?" + buildQuery())
      .then(function (data) {
        renderRows(data);
        renderPager(data);
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="empty-state">加载失败：' +
          esc(err && err.message ? err.message : "未知错误") +
          "</td></tr>";
      });
  }

  function renderRows(data) {
    var tbody = $("list-body");
    if (!tbody) return;

    var items = data.items || [];

    if (!items.length) {
      tbody.innerHTML =
        '<tr><td colspan="5"><div class="empty-state">' +
        "<p>暂无记录</p>" +
        '<p style="font-size:12px">换个筛选条件，或先去「记账」添加一笔</p>' +
        "</div></td></tr>";
      return;
    }

    tbody.innerHTML = items
      .map(function (r) {
        var isExpense = r.type === "expense";
        var amountClass = isExpense ? "amount-expense" : "amount-income";
        var sign = isExpense ? "-" : "+";

        return (
          "<tr>" +
          "<td>" + esc(r.date) + "</td>" +
          "<td>" + esc(r.category) + "</td>" +
          '<td class="' + amountClass + '">' + sign + "¥" + Number(r.amount).toFixed(2) + "</td>" +
          "<td>" + esc(r.note || "—") + "</td>" +
          "<td>" +
          '<button class="btn btn-secondary btn-sm" data-action="edit" data-id="' + esc(r.id) + '">编辑</button> ' +
          '<button class="btn btn-danger btn-sm" data-action="delete" data-id="' + esc(r.id) + '">删除</button>' +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function renderPager(data) {
    // 后端会把越界页码收敛到有效页，这里以响应里的 page 为准
    state.page = data.page;
    state.pages = data.pages;
    state.total = data.total;

    var pager = $("list-pager");
    if (!pager) return;

    if (data.pages <= 1) {
      pager.innerHTML = '<span style="color:#888;font-size:13px">共 ' + data.total + " 条</span>";
      return;
    }

    pager.innerHTML =
      '<button id="pg-prev"' + (data.page <= 1 ? " disabled" : "") + ">上一页</button>" +
      '<span class="current">' + data.page + " / " + data.pages + "</span>" +
      '<button id="pg-next"' + (data.page >= data.pages ? " disabled" : "") + ">下一页</button>" +
      '<span style="color:#888;font-size:13px">共 ' + data.total + " 条</span>";

    $("pg-prev").onclick = function () {
      if (state.page > 1) {
        state.page -= 1;
        load();
      }
    };

    $("pg-next").onclick = function () {
      if (state.page < state.pages) {
        state.page += 1;
        load();
      }
    };
  }

  /** 类型变化时重建类别下拉框，原来选中的类别仍存在就保留 */
  function syncCategoryOptions() {
    var type = $("f-type").value;
    var select = $("f-category");
    var previous = select.value;
    var list = categoriesFor(type);

    select.innerHTML =
      '<option value="">全部类别</option>' +
      list.map(function (category) {
        return '<option value="' + category + '">' + category + "</option>";
      }).join("");

    var stillExists = Array.prototype.some.call(select.options, function (option) {
      return option.value === previous;
    });
    select.value = stillExists ? previous : "";
  }

  function handleEdit(id) {
    // app.js 的 navigateTo 未对外暴露，通过点击导航项切换视图
    var nav = document.querySelector('.nav-item[data-view="record"]');
    if (nav && window.BookApp.state.currentView !== "record") nav.click();

    if (typeof window.BookApp.editRecord === "function") {
      window.BookApp.editRecord(id);
    }
  }

  function handleDelete(id) {
    if (!window.confirm("确定删除这条记录吗？删除后不可恢复。")) return;

    window.BookApp.api
      .del("/records/" + encodeURIComponent(id))
      .then(function () {
        window.BookApp.showToast("已删除", "success");
        load();
      })
      .catch(function (err) {
        window.BookApp.showToast((err && err.message) || "删除失败", "error");
      });
  }

  function render(container) {
    container.innerHTML =
      '<div class="card">' +
      "<h2>📋 收支明细</h2>" +

      '<div class="filter-bar">' +
      '<select id="f-type">' +
      '<option value="">全部类型</option>' +
      '<option value="expense">支出</option>' +
      '<option value="income">收入</option>' +
      "</select>" +
      '<select id="f-category"><option value="">全部类别</option></select>' +
      '<input type="date" id="f-from" title="开始日期">' +
      '<input type="date" id="f-to" title="结束日期">' +
      '<input type="text" id="f-q" placeholder="搜索备注…" style="min-width:140px">' +
      '<button class="btn btn-primary btn-sm" id="f-search">查询</button>' +
      '<button class="btn btn-secondary btn-sm" id="f-reset">重置</button>' +
      "</div>" +

      '<div class="table-wrap">' +
      "<table>" +
      "<thead><tr><th>日期</th><th>类别</th><th>金额</th><th>备注</th><th>操作</th></tr></thead>" +
      '<tbody id="list-body"></tbody>' +
      "</table>" +
      "</div>" +

      '<div class="pagination" id="list-pager"></div>' +
      "</div>";

    $("f-type").onchange = function () {
      syncCategoryOptions();
      state.page = 1;
      load();
    };

    $("f-category").onchange = function () {
      state.page = 1;
      load();
    };

    $("f-search").onclick = function () {
      state.page = 1;
      load();
    };

    $("f-q").onkeydown = function (event) {
      if (event.key === "Enter") {
        state.page = 1;
        load();
      }
    };

    $("f-reset").onclick = function () {
      $("f-type").value = "";
      syncCategoryOptions();
      $("f-from").value = "";
      $("f-to").value = "";
      $("f-q").value = "";
      state.page = 1;
      load();
    };

    // 行内按钮用事件委托，避免每次渲染都重新绑定
    $("list-body").onclick = function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;

      var id = button.dataset.id;
      if (button.dataset.action === "edit") handleEdit(id);
      if (button.dataset.action === "delete") handleDelete(id);
    };

    syncCategoryOptions();
    load();
  }

  window.BookApp = window.BookApp || {};
  window.BookApp.views = window.BookApp.views || {};
  window.BookApp.views.list = { render: render };
})();
