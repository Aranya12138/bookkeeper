/**
 * record.js — 记账模块前端（4号）
 *
 * 表单：支出/收入切换、类别联动、金额、日期（默认今天）、备注
 * 功能：新增、编辑回填、取消编辑；删除由 5 号列表负责二次确认后调用 API
 * 约定：列表点“编辑”调用 BookApp.editRecord(id) 回填表单
 */

window.BookApp = window.BookApp || {};
window.BookApp.views = window.BookApp.views || {};

// 类别枚举（与后端 models.py 保持一致）
const EXPENSE_CATEGORIES = ["饮食", "交通", "购物", "娱乐", "学习", "居住", "医疗", "其他"];
const INCOME_CATEGORIES = ["工资", "兼职", "红包", "理财", "其他"];

function categoriesFor(type) {
  return type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/** 今天的日期，格式 YYYY-MM-DD（作为日期输入框默认值） */
function today() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** 转义 HTML，防止后端错误信息（可能含用户输入）注入脚本 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function buildHTML() {
  return `
    <div class="card">
      <h2 id="record-form-title">📝 记一笔</h2>
      <form id="record-form" novalidate>
        <div class="form-group">
          <label>类型</label>
          <div class="type-toggle" style="display:flex; gap:8px;">
            <button type="button" class="btn btn-primary" data-type="expense">支出</button>
            <button type="button" class="btn btn-secondary" data-type="income">收入</button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="record-category">类别</label>
            <select id="record-category"></select>
          </div>
          <div class="form-group">
            <label for="record-amount">金额</label>
            <input type="number" id="record-amount" step="0.01" min="0" placeholder="0.00">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="record-date">日期</label>
            <input type="date" id="record-date">
          </div>
          <div class="form-group">
            <label for="record-note">备注（可选）</label>
            <input type="text" id="record-note" maxlength="100" placeholder="不超过 100 字">
          </div>
        </div>

        <div id="record-errors" style="display:none; background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; margin-bottom:12px; color:#b91c1c; font-size:13px;"></div>

        <div style="display:flex; gap:8px;">
          <button type="submit" class="btn btn-primary" id="record-submit">保存</button>
          <button type="button" class="btn btn-secondary" id="record-cancel" style="display:none;">取消编辑</button>
        </div>
      </form>
    </div>`;
}

function currentType(container) {
  const active = container.querySelector(".type-toggle .btn-primary");
  return active ? active.dataset.type : "expense";
}

function setType(container, type) {
  container.querySelectorAll(".type-toggle .btn").forEach((btn) => {
    const active = btn.dataset.type === type;
    btn.classList.toggle("btn-primary", active);
    btn.classList.toggle("btn-secondary", !active);
  });
}

function renderCategoryOptions(container, keepValue = false) {
  const select = container.querySelector("#record-category");
  const cats = categoriesFor(currentType(container));
  const prev = keepValue && select.value ? select.value : cats[0];
  select.innerHTML = cats.map((c) => `<option value="${c}">${c}</option>`).join("");
  select.value = cats.includes(prev) ? prev : cats[0];
}

function readForm(container) {
  const raw = container.querySelector("#record-amount").value;
  return {
    type: currentType(container),
    category: container.querySelector("#record-category").value,
    amount: raw === "" ? "" : Number(raw),
    date: container.querySelector("#record-date").value,
    note: container.querySelector("#record-note").value,
  };
}

function showErrors(container, errors) {
  const box = container.querySelector("#record-errors");
  if (!errors || errors.length === 0) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  box.style.display = "block";
  box.innerHTML = errors.map((e) => `<div>· ${escapeHtml(e)}</div>`).join("");
}

function setEditingMode(container, editing) {
  container.querySelector("#record-form-title").textContent = editing ? "✏️ 编辑记录" : "📝 记一笔";
  container.querySelector("#record-submit").textContent = editing ? "保存修改" : "保存";
  container.querySelector("#record-cancel").style.display = editing ? "" : "none";
}

function resetForm(container) {
  container.querySelector("#record-form").reset();
  setType(container, "expense");
  renderCategoryOptions(container);
  container.querySelector("#record-date").value = today();
  showErrors(container, []);
}

function fillForm(container, rec) {
  setType(container, rec.type === "income" ? "income" : "expense");
  renderCategoryOptions(container);
  container.querySelector("#record-category").value = rec.category;
  container.querySelector("#record-amount").value = rec.amount;
  container.querySelector("#record-date").value = rec.date;
  container.querySelector("#record-note").value = rec.note || "";
}

async function loadForEdit(container, id) {
  try {
    const data = await window.BookApp.api.get("/records/" + id);
    const rec = data && data.record ? data.record : data;
    if (!rec || !rec.id) throw new Error("记录不存在");
    fillForm(container, rec);
    setEditingMode(container, true);
  } catch (err) {
    const msg = (err && err.errors && err.errors[0]) || (err && err.message) || "加载记录失败";
    window.BookApp.showToast(msg, "error");
    window.BookApp.state.editingId = null;
    setEditingMode(container, false);
  }
}

function bindEvents(container) {
  // 支出/收入切换 → 类别下拉跟着变
  container.querySelectorAll(".type-toggle .btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setType(container, btn.dataset.type);
      renderCategoryOptions(container, true);
    });
  });

  // 提交（新增 / 更新）
  container.querySelector("#record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    showErrors(container, []);
    const editingId = window.BookApp.state.editingId;
    const payload = readForm(container);
    try {
      if (editingId) {
        await window.BookApp.api.put("/records/" + editingId, payload);
        window.BookApp.showToast("修改成功", "success");
      } else {
        await window.BookApp.api.post("/records", payload);
        window.BookApp.showToast("记账成功", "success");
      }
      window.BookApp.state.editingId = null;
      resetForm(container);
      setEditingMode(container, false);
    } catch (err) {
      const errors = (err && err.errors && err.errors.length)
        ? err.errors
        : [(err && err.message) || "保存失败"];
      showErrors(container, errors);
    }
  });

  // 取消编辑
  container.querySelector("#record-cancel").addEventListener("click", () => {
    window.BookApp.state.editingId = null;
    resetForm(container);
    setEditingMode(container, false);
    window.BookApp.showToast("已取消编辑", "info");
  });
}

function render(container) {
  container.innerHTML = buildHTML();
  bindEvents(container);

  // 默认新记一笔：支出、类别取第一项、日期默认今天
  setType(container, "expense");
  renderCategoryOptions(container);
  container.querySelector("#record-date").value = today();

  // 处于编辑态时加载并回填
  const editingId = window.BookApp.state && window.BookApp.state.editingId;
  if (editingId) {
    setEditingMode(container, true);
    loadForEdit(container, editingId);
  }
}

window.BookApp.views.record = { render };

/**
 * 编辑记录回填（被 5 号列表调用）
 * @param {string} id 记录 ID
 */
window.BookApp.editRecord = function (id) {
  window.BookApp.state = window.BookApp.state || {};
  window.BookApp.state.editingId = id;
  window.BookApp.state.currentView = "record";
  window.BookApp.refreshCurrentView();
};
