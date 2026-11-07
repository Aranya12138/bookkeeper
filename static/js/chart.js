/**
 * chart.js — 图表可视化（9号）
 *
 * 对外接口：
 *   Chart.pie(el, data)  — 饼图
 *   Chart.bar(el, data)  — 柱状图
 *   Chart.line(el, data) — 折线图
 *
 * data 格式：[{label: string, value: number}, ...]
 *
 * 优先使用 Chart.js CDN；若加载失败，手写 canvas 实现
 */

window.BookApp = window.BookApp || {};

const Chart = {
  /**
   * 饼图
   * @param {HTMLElement} el
   * @param {Array<{label: string, value: number}>} data
   */
  pie(el, data) {
    // TODO: 9号实现
  },

  /**
   * 柱状图
   * @param {HTMLElement} el
   * @param {Array<{label: string, value: number}>} data
   */
  bar(el, data) {
    // TODO: 9号实现
  },

  /**
   * 折线图
   * @param {HTMLElement} el
   * @param {Array<{label: string, value: number}>} data
   */
  line(el, data) {
    // TODO: 9号实现
  },
};

window.BookApp.chart = Chart;