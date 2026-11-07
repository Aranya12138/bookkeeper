/**
 * io.js — 导入导出前端（11号）
 *
 * 视图：导出按钮（JSON/CSV）、导入文件选择、结果报告
 * 注册：window.BookApp.views.io
 */

window.BookApp = window.BookApp || {};

(function () {
  /** 轻提示（10号提供 showToast，未实现时降级 console） */
  function toast(msg, type = "info") {
    if (typeof window.BookApp.showToast === "function") {
      window.BookApp.showToast(msg, type);
    } else {
      console.log(`[Toast:${type}] ${msg}`);
    }
  }

  /**
   * 提交导入文件
   * 注意：multipart 上传不能用 BookApp.api.post（它固定 JSON 头），
   * 这里直接用 fetch + FormData，Content-Type 由浏览器自动带 boundary。
   */
  async function uploadFile(file, reportEl, btn) {
    const formData = new FormData();
    formData.append("file", file);

    btn.disabled = true;
    btn.textContent = "导入中...";
    reportEl.innerHTML = "";

    try {
      const res = await fetch("/api/import", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        const errs = (data.errors || ["导入失败"]).map((e) => `<li>${escapeHtml(e)}</li>`).join("");
        reportEl.innerHTML = `<div class="card io-report io-report-error">
          <h3>❌ 导入失败</h3><ul>${errs}</ul></div>`;
        toast("导入失败，请查看错误详情", "error");
        return;
      }

      renderReport(data, reportEl);
      toast(`成功导入 ${data.imported} 条记录`, "success");

      // 导入后刷新其他视图的数据（若用户随后切换视图会重新渲染，这里只提示）
      if (data.imported > 0 && typeof window.BookApp.refreshCurrentView === "function") {
        // 当前视图保留结果报告，不做整视图刷新
      }
    } catch (err) {
      reportEl.innerHTML = `<div class="card io-report io-report-error">
        <h3>❌ 网络错误</h3><p>${escapeHtml(err.message)}</p></div>`;
      toast("网络错误，导入未完成", "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "开始导入";
    }
  }

  /** 渲染导入结果报告：导入数 / 跳过数 / 逐条错误 */
  function renderReport(data, reportEl) {
    const errorList = (data.errors || [])
      .map((e) => `<li>${escapeHtml(e)}</li>`)
      .join("");

    reportEl.innerHTML = `
      <div class="card io-report">
        <h3>📋 导入结果</h3>
        <div class="io-report-stats">
          <span class="io-stat io-stat-ok">✅ 导入 <b>${data.imported}</b> 条</span>
          <span class="io-stat io-stat-skip">⏭️ 跳过重复 <b>${data.skipped}</b> 条</span>
          <span class="io-stat io-stat-err">⚠️ 错误 <b>${(data.errors || []).length}</b> 条</span>
        </div>
        ${errorList ? `<details ${data.imported === 0 ? "open" : ""}>
          <summary>错误详情</summary>
          <ul class="io-error-list">${errorList}</ul>
        </details>` : ""}
      </div>`;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  window.BookApp.views.io = {
    render(container) {
      container.innerHTML = `
        <div class="card">
          <h2>📤 导出数据</h2>
          <p class="io-tip">把全部记账记录下载到本地备份，或交给 Excel 进一步分析。</p>
          <div class="form-row">
            <a class="btn btn-primary" href="/api/export?format=json" download>导出 JSON</a>
            <a class="btn btn-secondary" href="/api/export?format=csv" download>导出 CSV（Excel 可读）</a>
          </div>
        </div>

        <div class="card">
          <h2>📥 导入数据</h2>
          <p class="io-tip">支持 .json / .csv 文件（需为本应用导出格式）。重复记录（同类型、类别、金额、日期）会自动跳过。</p>
          <div class="form-group">
            <label for="io-file">选择文件</label>
            <input type="file" id="io-file" accept=".json,.csv">
          </div>
          <div class="form-row">
            <button id="io-import-btn" class="btn btn-primary" disabled>开始导入</button>
          </div>
          <div id="io-report"></div>
        </div>`;

      const fileInput = container.querySelector("#io-file");
      const importBtn = container.querySelector("#io-import-btn");
      const reportEl = container.querySelector("#io-report");

      // 选中文件后才允许点击导入，并显示文件名确认
      fileInput.addEventListener("change", () => {
        importBtn.disabled = !fileInput.files.length;
        reportEl.innerHTML = "";
      });

      importBtn.addEventListener("click", () => {
        const file = fileInput.files[0];
        if (!file) {
          toast("请先选择文件", "error");
          return;
        }
        uploadFile(file, reportEl, importBtn);
      });
    },
  };
})();
