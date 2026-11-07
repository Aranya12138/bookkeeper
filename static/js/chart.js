/*!
 * chart.js —— 个人记账本 · 图表可视化模块（分工 9 号）
 *
 * 自研 Canvas 实现，零第三方依赖。为什么不用 Chart.js：
 *   1) 现场没有网络也能跑，不用担心 CDN 挂掉；
 *   2) 对外接口完全按 CONTRACT.md 定死，6/7/8 号传什么就画什么；
 *   3) 不会出现 window.Chart 被两个库抢名字的问题。
 *
 * 对外接口（按 CONTRACT.md 挂在 BookApp.chart 上，同时给一个 window.Chart 别名）：
 *   BookApp.chart.pie (el, data, opts)   饼图 / 环形图
 *   BookApp.chart.bar (el, data, opts)   柱状图
 *   BookApp.chart.line(el, data, opts)   折线图
 *   BookApp.chart.destroy(el)            销毁某一容器上的图（切换视图时调用）
 *   （也可简写为 Chart.pie / Chart.bar / Chart.line）
 *
 *   el   : 容器元素，或 CSS 选择器字符串（如 '#chart-expense'）
 *   data : 统一格式 [{label, value}]，见下方「数据格式」
 *   opts : 可选，见下方「参数」
 *
 * 返回值：实例对象 { type, data, update(data), destroy() }
 *
 * ——— 数据格式 ———
 *   饼图 / 柱状图 / 折线图都吃同一种数组：[{label: '饮食', value: 320.5}, ...]
 *   为了少踩坑，下面这些写法也能直接认（6/7/8 号按自己方便传就行）：
 *     {category:'饮食', amount:320.5}   按 label 键 → category，按 value 键 → amount
 *     {period:'2026-09', expense:1200}  按 label 键 → period，按 value 键 → expense
 *     {bucket:'100-300', count:8}       按 label 键 → bucket，按 value 键 → count
 *   多系列折线图（比如同时画收入/支出），用 opts.series 指定取哪几个键：
 *     Chart.line(el, [{period:'9月', income:8000, expense:5200}, ...], {
 *       series: [{ key:'income', name:'收入' }, { key:'expense', name:'支出' }]
 *     })
 *
 * ——— 参数 opts ———
 *   height      : 画布高度 px。不传则读容器 CSS 高度，再不行用 260
 *   donut       : 饼图是否挖空，默认 true；传 false 是实心饼
 *   showValues  : 柱状图是否在柱顶标数值，默认柱数 <= 10 时开
 *   area        : 单系列折线是否加淡填充，默认 true
 *   currency    : 提示框金额前缀，默认 '¥'
 *
 * ——— 配色 ———
 * 颜色通过 CSS 变量读取，10 号在 style.css 里可以整站换肤；
 * 变量没定义就用模块内置的默认色（已通过色盲/对比度校验）。
 *   --viz-series-1 … --viz-series-8   8 个分类色，固定顺序，不循环生成
 *   --viz-income  --viz-expense        收入 / 支出专用色
 *   --viz-surface --viz-ink --viz-ink-2 --viz-muted --viz-grid --viz-axis
 */
(function (global) {
  'use strict';

  /* ============================ 主题令牌 ============================ */

  // 明色模式：8 个分类槽位按固定顺序取用，相邻对色盲 ΔE 最小 9.1，过线
  var LIGHT = {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100',
             '#e87ba4', '#008300', '#6250d6', '#e34948'],
    income: '#008300', expense: '#e34948',
    surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e',
    muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7'
  };

  // 暗色模式：同一批色相为深底重新取步，不是简单反色
  var DARK = {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500',
             '#d55181', '#008300', '#9085e9', '#e66767'],
    income: '#0ca30c', expense: '#e66767',
    surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7',
    muted: '#898781', grid: '#2c2c2a', axis: '#383835'
  };

  var FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';

  function prefersDark() {
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // 读 CSS 变量，没定义就退回默认值 —— 这样 10 号改了 style.css 整站同步
  function tokens() {
    var base = prefersDark() ? DARK : LIGHT;
    var cs = null;
    try { cs = global.getComputedStyle(document.documentElement); } catch (e) { cs = null; }
    function v(name, fallback) {
      if (!cs) return fallback;
      var s = (cs.getPropertyValue(name) || '').trim();
      return s || fallback;
    }
    var t = { series: [], income: v('--viz-income', base.income),
              expense: v('--viz-expense', base.expense),
              surface: v('--viz-surface', base.surface),
              ink: v('--viz-ink', base.ink),
              ink2: v('--viz-ink-2', base.ink2),
              muted: v('--viz-muted', base.muted),
              grid: v('--viz-grid', base.grid),
              axis: v('--viz-axis', base.axis) };
    for (var i = 1; i <= 8; i++) t.series.push(v('--viz-series-' + i, base.series[i - 1]));
    return t;
  }

  // 黄色系填充上要用深色字，其余用白字（保证填充内的百分比读得清）
  function inkOn(fill) {
    return /^#(eda100|c98500|fab219)$/i.test(fill) ? '#0b0b0b' : '#ffffff';
  }

  /* ============================ 数据归一化 ============================ */

  function pick(obj) {
    for (var i = 1; i < arguments.length; i++) {
      var k = arguments[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
    }
    return undefined;
  }

  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,¥$\s]/g, ''));
    return isFinite(n) ? n : 0;
  }

  // 统一成 [{label, value}]；认不出来的键直接忽略，不让一个脏字段搞崩整张图
  function toPoints(data) {
    if (!data) return [];
    if (data.items) data = data.items;           // 顺带兼容 5 号列表接口的返回
    if (!Array.isArray(data)) return [];
    var out = [];
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      if (d === null || d === undefined) continue;
      if (typeof d === 'number') { out.push({ label: String(i + 1), value: d }); continue; }
      var label = pick(d, 'label', 'period', 'category', 'bucket', 'name', 'x', 'date');
      var value = pick(d, 'value', 'amount', 'count', 'total', 'balance', 'expense', 'income', 'y');
      out.push({ label: label === undefined ? String(i + 1) : String(label), value: num(value) });
    }
    return out;
  }

  // 折线/柱状的多系列：要么走 opts.series，要么走 {labels, series} 结构，否则单系列
  function toSeries(data, opts) {
    if (data && !Array.isArray(data) && Array.isArray(data.series) && Array.isArray(data.labels)) {
      return {
        labels: data.labels.slice(),
        series: data.series.map(function (s, i) {
          return { name: s.name || ('系列 ' + (i + 1)), color: s.color || null,
                   values: (s.data || s.values || []).map(num) };
        })
      };
    }
    if (opts && Array.isArray(opts.series) && Array.isArray(data)) {
      return {
        labels: data.map(function (d, i) { return String(pick(d, 'label', 'period', 'category', 'bucket', 'name') || (i + 1)); }),
        series: opts.series.map(function (s) {
          return { name: s.name || s.key, color: s.color || null,
                   values: data.map(function (d) { return num(d[s.key]); }) };
        })
      };
    }
    var pts = toPoints(data);
    return {
      labels: pts.map(function (p) { return p.label; }),
      series: [{ name: (opts && opts.name) || '', color: null, values: pts.map(function (p) { return p.value; }) }]
    };
  }

  /* ============================ 绘图小工具 ============================ */

  function fmt(n, digits) {
    var d = digits === undefined ? 2 : digits;
    var neg = n < 0;
    n = Math.abs(n);
    var s = n.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');   // 去掉多余的小数 0
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var exp = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var f = v / exp;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * exp;
  }

  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }

  function roundRectTop(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, Math.abs(h)));
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  function text(ctx, str, x, y, opt) {
    opt = opt || {};
    ctx.save();
    ctx.font = (opt.font || ('12px ' + FONT));
    ctx.fillStyle = opt.color || '#000';
    ctx.textAlign = opt.align || 'left';
    ctx.textBaseline = opt.baseline || 'alphabetic';
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function measure(ctx, str, font) {
    ctx.save();
    ctx.font = font || ('12px ' + FONT);
    var w = ctx.measureText(str).width;
    ctx.restore();
    return w;
  }

  // 空数据占位：不画坐标轴，直接给一句人话
  function drawEmpty(ctx, w, h, t, msg) {
    var cy = h / 2;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(w / 2, cy - 10, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(w / 2 - 7, cy - 17); ctx.lineTo(w / 2 + 7, cy - 3);
    ctx.moveTo(w / 2 + 7, cy - 17); ctx.lineTo(w / 2 - 7, cy - 3);
    ctx.strokeStyle = t.muted;
    ctx.stroke();
    ctx.restore();
    text(ctx, msg || '暂无数据', w / 2, cy + 24, { color: t.muted, align: 'center', baseline: 'middle' });
  }

  /* ============================ 提示框 ============================ */

  function makeTip(el) {
    var t = tokens();
    var dark = prefersDark();
    var tip = document.createElement('div');
    tip.className = 'viz-tip';
    tip.style.cssText =
      'position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;' +
      'z-index:20;padding:8px 10px;border-radius:8px;font:12px/1.5 ' + FONT + ';' +
      'white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
      'background:' + (dark ? '#262624' : '#ffffff') + ';color:' + t.ink + ';' +
      'border:1px solid ' + (dark ? 'rgba(255,255,255,.12)' : 'rgba(11,11,11,.10)') + ';';
    el.appendChild(tip);
    return tip;
  }

  function showTip(tip, el, x, y, html) {
    tip.innerHTML = html;
    tip.style.opacity = '1';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var cw = el.clientWidth;
    var left = x + 14;
    if (left + w > cw - 4) left = x - w - 14;
    if (left < 4) left = 4;
    var top = y - h - 12;
    if (top < 0) top = y + 16;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hideTip(tip) { tip.style.opacity = '0'; }

  function tipRow(t, color, name, value, opts) {
    var cur = (opts && opts.currency) || '¥';
    return '<div style="display:flex;align-items:center;gap:8px;margin-top:4px">' +
      '<span style="width:8px;height:8px;border-radius:2px;background:' + color + ';flex:none"></span>' +
      '<span style="opacity:.72">' + name + '</span>' +
      '<span style="margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600">' +
      cur + fmt(value) + '</span></div>';
  }

  /* ============================ 实例管理 ============================ */

  var registry = [];   // [{el, inst}] —— 用数组而不是 WeakMap，方便 destroyAll

  function findInst(el) {
    for (var i = 0; i < registry.length; i++) if (registry[i].el === el) return registry[i].inst;
    return null;
  }

  function unregister(el) {
    for (var i = registry.length - 1; i >= 0; i--) if (registry[i].el === el) registry.splice(i, 1);
  }

  function resolve(el) {
    if (typeof el === 'string') el = document.querySelector(el);
    return el || null;
  }

  // app.js 切视图是 container.innerHTML 整块替换，旧容器连同画布一起被摘掉，
  // 但 ResizeObserver 还挂在那个已经不在文档里的节点上。每次建新图时顺手扫一遍，
  // 免得来回切视图越积越多。6/7/8 号就算忘了 destroy 也不会漏。
  function sweep() {
    for (var i = registry.length - 1; i >= 0; i--) {
      var el = registry[i].el;
      if (el.isConnected === false) registry[i].inst.destroy();
    }
  }

  function build(type, elArg, data, opts) {
    sweep();
    var el = resolve(elArg);
    if (!el) { console.warn('[chart] 找不到容器：', elArg); return null; }
    var old = findInst(el);
    if (old) old.destroy();
    if (global.getComputedStyle(el).position === 'static') el.style.position = 'relative';

    // 先量容器高度，再把画布插进去。
    // 反过来的话：canvas 自带 2:1 的固有宽高比，width:100%(880px) 且 height 未定时
    // 浏览器会按比例算出 440px，容器被自己的内容撑高，形成「画布越大容器越高」的反馈环。
    var h0 = el.clientHeight;

    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:' +
      ((opts && opts.height) || h0 || 260) + 'px';
    el.appendChild(canvas);
    var tip = makeTip(el);

    var inst = {
      type: type, el: el, canvas: canvas, tip: tip,
      ctx: canvas.getContext('2d'),
      data: data, opts: opts || {},
      h0: h0,
      hover: -1,
      _raf: 0,
      _ro: null
    };

    inst.draw = function () { paint(inst); };
    inst.update = function (d) { inst.data = d; inst.hover = -1; paint(inst); };
    inst.destroy = function () {
      if (inst._raf) cancelAnimationFrame(inst._raf);
      if (inst._ro) { try { inst._ro.disconnect(); } catch (e) {} }
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      if (tip.parentNode) tip.parentNode.removeChild(tip);
      unregister(el);
    };

    function onMove(e) { handleMove(inst, e); }
    function onLeave() { inst.hover = -1; hideTip(tip); paint(inst); }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    // 窗口缩放 / 容器尺寸变化都重画（rAF 合并，避免拖动时狂刷）
    function schedule() {
      if (inst._raf) return;
      inst._raf = requestAnimationFrame(function () { inst._raf = 0; paint(inst); });
    }
    if (global.ResizeObserver) {
      inst._ro = new ResizeObserver(schedule);
      inst._ro.observe(el);
    } else {
      global.addEventListener('resize', schedule);
    }

    registry.push({ el: el, inst: inst });
    paint(inst);
    return inst;
  }

  /* ============================ 绘制总调度 ============================ */

  function paint(inst) {
    var el = inst.el, cv = inst.canvas, ctx = inst.ctx, t = tokens();
    var w = el.clientWidth || 300;
    // 高度用插入画布前量到的 h0，不再读 el.clientHeight —— 否则容器会被画布自己撑高
    var h = inst.opts.height || inst.h0 || 260;
    var dpr = global.devicePixelRatio || 1;

    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = t.surface;
    ctx.fillRect(0, 0, w, h);

    if (w < 40 || h < 40) return;   // 容器还没布局好，等 ResizeObserver 再画

    if (inst.type === 'pie') paintPie(ctx, w, h, inst, t);
    else if (inst.type === 'bar') paintBar(ctx, w, h, inst, t);
    else paintLine(ctx, w, h, inst, t);
  }

  /* ============================ 饼图 / 环形图 ============================ */

  function pieItems(inst, t) {
    var pts = toPoints(inst.data).filter(function (p) { return p.value > 0; });
    if (!pts.length) return [];
    // 超过 8 个分类就把尾巴并成「其他」，不生成第 9 种颜色
    if (pts.length > 8) {
      var sorted = pts.slice().sort(function (a, b) { return b.value - a.value; });
      var head = sorted.slice(0, 7);
      var restVal = sum(sorted.slice(7).map(function (p) { return p.value; }));
      head.push({ label: '其他', value: restVal, other: true });
      pts = head;
    }
    var total = sum(pts.map(function (p) { return p.value; }));
    pts.forEach(function (p, i) {
      p.color = p.other ? t.muted : t.series[i % 8];
      p.pct = total > 0 ? p.value / total : 0;
      p.start = 0; p.end = 0;
    });
    return pts;
  }

  function paintPie(ctx, w, h, inst, t) {
    var items = pieItems(inst, t);
    if (!items.length) { drawEmpty(ctx, w, h, t); return; }

    var donut = inst.opts.donut !== false;
    var pad = 10;
    var rowH = 22;

    // 先把图例量出来再排版：图例放右边会吃掉横向空间，放底下会吃掉纵向空间。
    // 卡片普遍是「宽而矮」（240px 高），所以优先放右边；放不下才沉到底部，且底部改成多列，
    // 否则 8 个分类的图例能把饼挤成 30px 半径。
    var maxW = 0;
    items.forEach(function (p) {
      maxW = Math.max(maxW, measure(ctx, p.label + '  ' + (p.pct * 100).toFixed(1) + '%'));
    });
    var legendW = Math.min(w * 0.46, maxW + 34);
    var rightLegend = w >= 300 && items.length * rowH <= h - pad * 2;

    var cols = 1, rows = items.length;
    if (!rightLegend) {
      cols = w >= 300 ? 2 : 1;
      rows = Math.ceil(items.length / cols);
    }

    var legendH = rightLegend ? 0 : rows * 18 + 8;
    var availW = w - pad * 2 - (rightLegend ? legendW + 12 : 0);
    var availH = h - pad * 2 - legendH;
    var R = Math.max(16, Math.min(availW, availH) / 2 - 4);
    var cx = pad + availW / 2;
    var cy = pad + availH / 2;

    // 固定 gap：切片之间留 2px 底色缝，相邻色块不会糊在一起
    var gap = items.length > 1 ? Math.min(0.05, 2 / R) : 0;
    var start = -Math.PI / 2;

    items.forEach(function (p, i) {
      var sweep = p.pct * Math.PI * 2;
      p.start = start + gap / 2;
      p.end = start + sweep - gap / 2;
      if (p.end < p.start) p.end = p.start;
      start += sweep;
    });

    var hovered = inst.hover >= 0 && inst.hover < items.length ? items[inst.hover] : null;

    items.forEach(function (p, i) {
      var isHover = hovered === p;
      var mid = (p.start + p.end) / 2;
      var off = isHover ? 6 : 0;
      var ox = Math.cos(mid) * off, oy = Math.sin(mid) * off;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx + ox, cy + oy);
      ctx.arc(cx + ox, cy + oy, R, p.start, p.end);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.restore();
    });

    // 环形中间写总额，饼图没有中间就不写
    if (donut) {
      var total = sum(items.map(function (p) { return p.value; }));
      var innerR = R * 0.56;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.fillStyle = t.surface;
      ctx.fill();
      ctx.restore();
      // 圆孔小的时候 18px 的金额会溢出到色块上，按孔径自动缩字号；实在塞不下就不写
      var totalTxt = '¥' + fmt(total);
      var fsz = 18;
      while (fsz > 11 && measure(ctx, totalTxt, '700 ' + fsz + 'px ' + FONT) > innerR * 1.72) fsz -= 1;
      if (innerR >= 26 && measure(ctx, totalTxt, '700 ' + fsz + 'px ' + FONT) <= innerR * 1.78) {
        text(ctx, '合计', cx, cy - fsz * 0.62, { color: t.muted, align: 'center', baseline: 'middle' });
        text(ctx, totalTxt, cx, cy + fsz * 0.52, {
          color: t.ink, align: 'center', baseline: 'middle', font: '700 ' + fsz + 'px ' + FONT
        });
      }
    }

    // 只给最大的一块直接标百分比（其余靠图例和悬停），不在每块上堆数字
    var biggest = items.reduce(function (a, b) { return b.pct > a.pct ? b : a; }, items[0]);
    if (biggest.pct >= 0.08) {
      var ang = (biggest.start + biggest.end) / 2;
      var lr = donut ? (R + R * 0.56) / 2 : R * 0.66;
      text(ctx, (biggest.pct * 100).toFixed(0) + '%',
        cx + Math.cos(ang) * lr, cy + Math.sin(ang) * lr,
        { color: inkOn(biggest.color), align: 'center', baseline: 'middle', font: '600 12px ' + FONT });
    }

    // 图例：颜色必须配文字，不能只靠颜色区分（收入/支出那对在色盲下 ΔE 仅 7.2）
    if (rightLegend) {
      var lx = w - pad - legendW + 6;
      var ly = Math.max(pad, cy - (items.length * rowH) / 2 + rowH / 2);
      items.forEach(function (p, i) {
        var y = ly + i * rowH;
        ctx.fillStyle = p.color;
        roundRectTop(ctx, lx, y - 5, 10, 10, 2);   // 图例色块
        ctx.fill();
        text(ctx, p.label, lx + 16, y + 4, { color: t.ink2 });
        text(ctx, (p.pct * 100).toFixed(1) + '%', w - pad, y + 4, {
          color: t.muted, align: 'right', font: '12px ' + FONT
        });
      });
    } else {
      var colW = (w - pad * 2) / cols;
      var ly2 = h - pad - rows * 18 + 4;
      items.forEach(function (p, i) {
        var cIdx = Math.floor(i / rows), rIdx = i % rows;
        var bx = pad + cIdx * colW;
        var y = ly2 + rIdx * 18;
        ctx.fillStyle = p.color;
        ctx.fillRect(bx, y - 5, 10, 10);
        text(ctx, p.label, bx + 16, y + 4, { color: t.ink2 });
        text(ctx, (p.pct * 100).toFixed(1) + '%', bx + colW - 6, y + 4, { color: t.muted, align: 'right' });
      });
    }

    inst._hit = items.map(function (p) {
      return { start: p.start, end: p.end, cx: cx, cy: cy, r: R, item: p };
    });
  }

  /* ============================ 柱状图 ============================ */

  function paintBar(ctx, w, h, inst, t) {
    var sd = toSeries(inst.data, inst.opts);
    var labels = sd.labels, series = sd.series;
    var n = labels.length;

    var flat = [];
    series.forEach(function (s) { flat = flat.concat(s.values); });
    var maxV = Math.max.apply(null, flat.concat([0]));
    var hasNeg = Math.min.apply(null, flat.concat([0])) < 0;

    if (!n || maxV <= 0 && !hasNeg) { drawEmpty(ctx, w, h, t); return; }

    var top = niceMax(maxV);
    var ticks = 4;
    var tickVals = [];
    for (var i = 0; i <= ticks; i++) tickVals.push((top / ticks) * i);

    var tickLabels = tickVals.map(function (v) { return fmt(v, top < 10 ? 1 : 0); });
    var padL = Math.max.apply(null, tickLabels.map(function (s) { return measure(ctx, s); })) + 12;
    var padR = 8, padT = 16;

    // 先判 x 轴标签要不要斜着写，再决定底部留多高 —— 否则斜标签会被画布底边切断
    var slot = Math.max(1, w - padL - padR) / n;
    var maxLbl = 0;
    labels.forEach(function (l) { maxLbl = Math.max(maxLbl, measure(ctx, l, '11px ' + FONT)); });
    var rotate = maxLbl > slot - 8 && n > 1;

    // 斜排时把共有的年份前缀剥掉。6 号的 period 是 "2026-10-01"，
    // 一个月 30 多根柱子挤在 880px 里，斜着写有 58px 长，末端会从画布底边漏出去。
    // 一年之内的日期前四位本来就是冗余的；跨年时前缀不一致，就原样保留。
    if (rotate) {
      var yPrefix = (/^(\d{4})-(?=\d)/.exec(labels[0] || '') || [])[1];
      if (yPrefix) {
        var cut = yPrefix + '-';
        var same = true;
        for (var q = 0; q < labels.length; q++) {
          if (String(labels[q]).indexOf(cut) !== 0) { same = false; break; }
        }
        if (same) {
          labels = labels.map(function (l) { return String(l).slice(cut.length); });
          maxLbl = 0;
          labels.forEach(function (l) { maxLbl = Math.max(maxLbl, measure(ctx, l, '11px ' + FONT)); });
        }
      }
    }

    // 底部留白按「斜排后实际占多高」算，不写死 —— 只留 36px 的话长标签会被切。
    var padB = rotate ? Math.max(30, Math.ceil(maxLbl * Math.sin(Math.PI / 5)) + 14) : 26;

    var plot = { x: padL, y: padT, w: Math.max(10, w - padL - padR), h: Math.max(10, h - padT - padB) };
    var y0 = plot.y + plot.h;   // 基线

    // 网格 + y 轴刻度（故意压得很淡，数据才是主角）
    ctx.save();
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    tickVals.forEach(function (v, idx) {
      var y = y0 - (v / top) * plot.h;
      ctx.beginPath();
      ctx.moveTo(plot.x, Math.round(y) + .5);
      ctx.lineTo(plot.x + plot.w, Math.round(y) + .5);
      ctx.stroke();
      text(ctx, tickLabels[idx], plot.x - 8, y, {
        color: t.muted, align: 'right', baseline: 'middle', font: '11px ' + FONT
      });
    });
    ctx.strokeStyle = t.axis;
    ctx.beginPath();
    ctx.moveTo(plot.x, Math.round(y0) + .5);
    ctx.lineTo(plot.x + plot.w, Math.round(y0) + .5);
    ctx.stroke();
    ctx.restore();

    // 柱宽：分组柱之间留 2px 缝
    var groupW = slot * 0.68;
    var barW = series.length > 1 ? Math.max(3, groupW / series.length - 2) : Math.min(groupW, 46);
    var showVals = inst.opts.showValues !== undefined
      ? inst.opts.showValues
      : (n <= 10 && series.length === 1);

    labels.forEach(function (lbl, i) {
      var cx = plot.x + slot * (i + 0.5);
      var hoveredCol = inst.hover === i;

      series.forEach(function (s, si) {
        var v = s.values[i] || 0;
        var bh = top > 0 ? (v / top) * plot.h : 0;
        var bx = series.length > 1
          ? cx - groupW / 2 + si * (barW + 2)
          : cx - barW / 2;
        var color = seriesColor(s, si, t, series.length > 1);

        ctx.save();
        ctx.globalAlpha = (inst.hover < 0 || hoveredCol) ? 1 : 0.55;   // 悬停时其它列退到后面
        ctx.fillStyle = color;
        if (v >= 0) {
          roundRectTop(ctx, bx, y0 - bh, barW, bh, 4);
        } else {
          roundRectTop(ctx, bx, y0, barW, -bh, 4);
        }
        ctx.fill();
        ctx.restore();

        if (showVals && v !== 0) {
          text(ctx, fmt(v, v < 100 ? 1 : 0), bx + barW / 2,
            v >= 0 ? y0 - bh - 6 : y0 + (-bh) + 12,
            { color: t.ink2, align: 'center', font: '11px ' + FONT });
        }
      });

      ctx.save();
      if (rotate) {
        ctx.translate(cx, y0 + 8);
        ctx.rotate(-Math.PI / 5);
        text(ctx, lbl, 0, 0, { color: t.muted, align: 'right', baseline: 'middle', font: '11px ' + FONT });
      } else {
        text(ctx, lbl, cx, y0 + 16, { color: t.muted, align: 'center', font: '11px ' + FONT });
      }
      ctx.restore();
    });

    // 多系列必须有图例（颜色不是唯一线索）
    if (series.length > 1) {
      var lx = plot.x, ly = 8;
      series.forEach(function (s, si) {
        var color = seriesColor(s, si, t, true);
        ctx.fillStyle = color;
        ctx.fillRect(lx, ly - 5, 9, 9);
        text(ctx, s.name, lx + 13, ly + 3, { color: t.ink2, font: '11px ' + FONT });
        lx += 13 + measure(ctx, s.name, '11px ' + FONT) + 16;
      });
    }

    inst._bars = { slot: slot, x0: plot.x, count: n, y0: y0, top: top, h: plot.h, series: series };
  }

  /* ============================ 折线图 ============================ */

  function paintLine(ctx, w, h, inst, t) {
    var sd = toSeries(inst.data, inst.opts);
    var labels = sd.labels, series = sd.series;
    var n = labels.length;
    var flat = [];
    series.forEach(function (s) { flat = flat.concat(s.values); });
    var maxV = Math.max.apply(null, flat.concat([0]));

    if (!n || maxV <= 0) { drawEmpty(ctx, w, h, t); return; }

    var top = niceMax(maxV);
    var ticks = 4;
    var tickVals = [], tickLabels = [];
    for (var i = 0; i <= ticks; i++) {
      var v = (top / ticks) * i;
      tickVals.push(v);
      tickLabels.push(fmt(v, top < 10 ? 1 : 0));
    }

    var padL = Math.max.apply(null, tickLabels.map(function (s) { return measure(ctx, s); })) + 12;
    var padR = 10, padT = 18, padB = 26;
    if (series.length > 1) padT = 26;
    var plot = { x: padL, y: padT, w: Math.max(10, w - padL - padR), h: Math.max(10, h - padT - padB) };
    var y0 = plot.y + plot.h;
    var stepX = n > 1 ? plot.w / (n - 1) : 0;
    var px = function (i) { return n > 1 ? plot.x + i * stepX : plot.x + plot.w / 2; };
    var py = function (v) { return y0 - (v / top) * plot.h; };

    ctx.save();
    ctx.strokeStyle = t.grid;
    ctx.lineWidth = 1;
    tickVals.forEach(function (v, idx) {
      var y = py(v);
      ctx.beginPath();
      ctx.moveTo(plot.x, Math.round(y) + .5);
      ctx.lineTo(plot.x + plot.w, Math.round(y) + .5);
      ctx.stroke();
      text(ctx, tickLabels[idx], plot.x - 8, y, {
        color: t.muted, align: 'right', baseline: 'middle', font: '11px ' + FONT
      });
    });
    ctx.restore();

    // x 轴标签抽稀：保证相邻标签至少隔 56px
    var every = Math.max(1, Math.ceil(56 / Math.max(1, stepX)));
    labels.forEach(function (lbl, i) {
      if (i % every !== 0 && i !== n - 1) return;
      // 首尾标签居中会被画布边缘切掉半截，贴边时改成左/右对齐
      var lw = measure(ctx, lbl, '11px ' + FONT);
      var cxL = px(i), align = 'center', tx = cxL;
      if (cxL - lw / 2 < 2) { align = 'left'; tx = Math.max(2, cxL - lw / 2); }
      else if (cxL + lw / 2 > w - 2) { align = 'right'; tx = Math.min(w - 2, cxL + lw / 2); }
      text(ctx, lbl, tx, y0 + 16, { color: t.muted, align: align, font: '11px ' + FONT });
    });

    // 每条线：淡填充（单系列）+ 2px 线 + 8px 圆点（带 2px 底色描边，重叠也分得开）
    series.forEach(function (s, si) {
      var color = seriesColor(s, si, t, series.length > 1);
      var vals = s.values;

      if (inst.opts.area !== false && series.length === 1) {
        var grad = ctx.createLinearGradient(0, plot.y, 0, y0);
        grad.addColorStop(0, hexA(color, 0.16));
        grad.addColorStop(1, hexA(color, 0.01));
        ctx.beginPath();
        ctx.moveTo(px(0), y0);
        for (var a = 0; a < n; a++) ctx.lineTo(px(a), py(vals[a] || 0));
        ctx.lineTo(px(n - 1), y0);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.save();
      ctx.beginPath();
      for (var b = 0; b < n; b++) {
        if (b === 0) ctx.moveTo(px(b), py(vals[b] || 0));
        else ctx.lineTo(px(b), py(vals[b] || 0));
      }
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();

      for (var c = 0; c < n; c++) {
        var isHover = inst.hover === c;
        ctx.beginPath();
        ctx.arc(px(c), py(vals[c] || 0), isHover ? 5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = t.surface;
        ctx.stroke();
      }
    });

    // 十字准线：折线图默认就该有，不然读者没法对齐到某一天
    if (inst.hover >= 0 && inst.hover < n) {
      var hx = px(inst.hover);
      ctx.save();
      ctx.strokeStyle = t.axis;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(hx) + .5, plot.y);
      ctx.lineTo(Math.round(hx) + .5, y0);
      ctx.stroke();
      ctx.restore();
    }

    if (series.length > 1) {
      var lx = plot.x, ly = 10;
      series.forEach(function (s, si) {
        var color = seriesColor(s, si, t, true);
        ctx.beginPath();
        ctx.arc(lx + 4, ly, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        text(ctx, s.name, lx + 13, ly + 3, { color: t.ink2, font: '11px ' + FONT });
        lx += 13 + measure(ctx, s.name, '11px ' + FONT) + 18;
      });
    }

    inst._line = { px: px, stepX: stepX, plot: plot, count: n, series: series, padL: padL };
  }

  // Canvas 不认 CSS 变量，传 'var(--viz-income)' 会静默变成上一个颜色。
  // 所以系列色统一从这里过一道：是 var() 就现查一次真值。
  function col(c) {
    if (!c) return '';
    c = String(c).trim();
    if (c.indexOf('var(') === 0) {
      var name = c.slice(4, c.indexOf(')')).trim();
      var v = '';
      try { v = global.getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) {}
      return v || '';
    }
    return c;
  }

  function seriesColor(s, si, t, multi) {
    var c = col(s.color);
    if (c) return c;
    return multi ? t.series[si % 8] : t.series[0];
  }

  function hexA(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return 'rgba(42,120,214,' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  /* ============================ 悬停交互 ============================ */

  function localPoint(el, e) {
    var r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handleMove(inst, e) {
    var p = localPoint(inst.el, e);
    var changed = false;
    var html = '';

    if (inst.type === 'pie') {
      var hit = -1;
      if (inst._hit) {
        for (var i = 0; i < inst._hit.length; i++) {
          var s = inst._hit[i];
          var dx = p.x - s.cx, dy = p.y - s.cy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > s.r + 2) continue;
          var ang = Math.atan2(dy, dx);
          while (ang < s.start) ang += Math.PI * 2;
          while (ang > s.start + Math.PI * 2) ang -= Math.PI * 2;
          if (ang >= s.start && ang <= s.end) { hit = i; break; }
        }
      }
      if (hit !== inst.hover) { inst.hover = hit; changed = true; }
      if (hit >= 0) {
        var it = inst._hit[hit].item;
        html = '<div style="font-weight:600">' + it.label + '</div>' +
               tipRow(tokens(), it.color, '金额', it.value, inst.opts) +
               '<div style="color:#898781;margin-top:2px">占比 ' + (it.pct * 100).toFixed(1) + '%</div>';
      }
    } else if (inst.type === 'bar') {
      var b = inst._bars;
      if (b && p.x >= b.x0 && p.x <= b.x0 + b.slot * b.count) {
        var idx = Math.floor((p.x - b.x0) / b.slot);
        idx = Math.max(0, Math.min(b.count - 1, idx));
        if (idx !== inst.hover) { inst.hover = idx; changed = true; }
        var rows = '';
        b.series.forEach(function (s, si) {
          rows += tipRow(tokens(), seriesColor(s, si, tokens(), true), s.name || '金额', s.values[idx] || 0, inst.opts);
        });
        html = '<div style="font-weight:600;margin-bottom:2px">' +
               (inst._labels ? inst._labels[idx] : toSeries(inst.data, inst.opts).labels[idx]) + '</div>' + rows;
      } else {
        if (inst.hover !== -1) { inst.hover = -1; changed = true; }
      }
    } else {
      var ln = inst._line;
      if (ln && p.x >= ln.plot.x - ln.stepX / 2 && p.x <= ln.plot.x + ln.plot.w + ln.stepX / 2) {
        var idx2 = ln.stepX > 0 ? Math.round((p.x - ln.plot.x) / ln.stepX) : 0;
        idx2 = Math.max(0, Math.min(ln.count - 1, idx2));
        if (idx2 !== inst.hover) { inst.hover = idx2; changed = true; }
        var rows2 = '';
        ln.series.forEach(function (s, si) {
          rows2 += tipRow(tokens(), seriesColor(s, si, tokens(), true), s.name || '数值', s.values[idx2] || 0, inst.opts);
        });
        html = '<div style="font-weight:600;margin-bottom:2px">' +
               toSeries(inst.data, inst.opts).labels[idx2] + '</div>' + rows2;
      } else {
        if (inst.hover !== -1) { inst.hover = -1; changed = true; }
      }
    }

    if (changed) paint(inst);
    if (html) showTip(inst.tip, inst.el, p.x, p.y, html);
    else hideTip(inst.tip);
  }

  /* ============================ 对外接口 ============================ */

  var Chart = {
    __bookapp: true,
    version: '1.0.0',

    pie: function (el, data, opts) { return build('pie', el, data, opts); },
    bar: function (el, data, opts) { return build('bar', el, data, opts); },
    line: function (el, data, opts) { return build('line', el, data, opts); },

    destroy: function (el) {
      var node = resolve(el);
      var inst = node && findInst(node);
      if (inst) inst.destroy();
    },
    destroyAll: function () {
      registry.slice().forEach(function (r) { r.inst.destroy(); });
    },

    // 给 10 号做图例色块 / 6·7·8 号自己画小色条时用
    colors: function (n) {
      var t = tokens();
      var out = [];
      for (var i = 0; i < (n || 8); i++) out.push(t.series[i % 8]);
      return out;
    },

    /**
     * 在某个锚点元素旁边自动放一个 .chart-box 并画图。
     * 6/7/8 号不用自己写容器，页面上也不用手动加 div：
     *   BookApp.chart.into('#category-list', data, { type:'pie', id:'chart-category' });
     * @param {string|HTMLElement} anchor 锚点，图表插在它前面
     * @param {Array} data
     * @param {{type?:string, id?:string, before?:boolean}} opts
     */
    into: function (anchor, data, opts) {
      opts = opts || {};
      var box = ensureBox(anchor, opts.id, opts.before !== false);
      if (!box) return null;
      var kind = opts.type || 'pie';
      return Chart[kind](box, data, opts);
    }
  };

  /* ============================ 与 6/7/8 号的对接 ============================ */

  // 找到（或造出）挂在锚点旁边的容器。视图重新渲染后旧容器会脱离文档，
  // 这里用 isConnected 判断，避免把图画到一个已经不在页面上的 div 里。
  function ensureBox(anchor, id, before) {
    var a = resolve(anchor);
    if (!a || !a.parentNode) return null;
    id = id || 'chart-box';
    var box = document.getElementById(id);
    if (box && box.isConnected) return box;
    box = document.createElement('div');
    box.id = id;
    box.className = 'chart-box';
    if (before) a.parentNode.insertBefore(box, a);
    else a.parentNode.insertBefore(box, a.nextSibling);
    return box;
  }

  // 7 号已经实现的约定：数据挂到 BookApp.categoryChartData，同时派发 categoryStatsUpdated
  if (global.addEventListener) {
    global.addEventListener('categoryStatsUpdated', function (e) {
      var data = (e && e.detail) || (global.BookApp && global.BookApp.categoryChartData) || [];
      if (!data || !data.length) return;
      Chart.into('#category-list', data, { id: 'chart-category', type: 'pie' });
    });
  }

  if (global.Chart && !global.Chart.__bookapp) {
    console.warn('[chart] 页面里已经加载了第三方 Chart.js，window.Chart 会被本模块覆盖。' +
                 '如果只是想用本模块，请从 index.html 里去掉 Chart.js 的 <script>。');
  }

  global.BookApp = global.BookApp || {};
  global.BookApp.chart = Chart;   // CONTRACT.md 约定的名字
  global.BookApp.Chart = Chart;
  global.Chart = Chart;           // 简写别名

})(window);
