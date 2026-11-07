/**
 * app.js — 前端应用主入口（1号·组长）
 *
 * 负责：导航切换、视图调度、全局状态初始化。
 * 约定：各功能模块 JS 自注册 window.BookApp.views.<name> = { render(container) }
 */

window.BookApp = window.BookApp || {};

/** 全局共享状态 */
window.BookApp.state = {
  currentView: "record", // 当前视图名
  editingId: null,       // 正在编辑的记录 ID
};

/** 视图注册表（各模块在 app.js 之前加载，故保留已注册的视图） */
window.BookApp.views = window.BookApp.views || {};

/**
 * Toast 占位（由 10 号在 index.html 中实现后替换）
 */
window.BookApp.showToast = function (msg, type = "info") {
  console.log(`[Toast:${type}] ${msg}`);
  // 10号 TODO: 替换为真实 DOM toast
};

/**
 * 由 4 号实现：点击"编辑"回填表单
 * @param {string} id - 记录 ID
 */
window.BookApp.editRecord = window.BookApp.editRecord || function (id) {
  console.warn("editRecord 尚未由 4 号实现，id:", id);
  // 4号 TODO: 实现编辑回填逻辑
};

/** 刷新当前视图 */
window.BookApp.refreshCurrentView = function () {
  navigateTo(window.BookApp.state.currentView);
};

/**
 * 导航到指定视图
 * @param {string} name - 视图名称（对应 views.<name>）
 */
function navigateTo(name) {
  const container = document.getElementById("view-container");
  if (!container) {
    console.error("view-container 未找到，请检查 index.html");
    return;
  }

  window.BookApp.state.currentView = name;

  // 更新导航高亮
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === name);
  });

  // 清空容器
  container.innerHTML = "";

  // 渲染目标视图
  const view = window.BookApp.views[name];
  if (view && typeof view.render === "function") {
    view.render(container);
  } else {
    container.innerHTML = `<div class="empty-state">
      <p>模块「${name}」尚未实现</p>
    </div>`;
  }
}

/** 初始化：绑定导航事件 */
function initApp() {
  document.querySelectorAll(".nav-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const viewName = el.dataset.view;
      if (viewName) navigateTo(viewName);
    });
  });

  // 默认打开记账视图
  navigateTo("record");
}

// DOM 就绪后初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}