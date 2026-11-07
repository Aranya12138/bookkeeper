# 9 号 · 博客素材（图表可视化模块）

> 草稿。分工要求每人两段：「我的模块关键代码」+「团队编程体验」。
> 标了 `【】` 的地方是需要你按实际情况补的，别照抄。

---

## 我的模块关键代码

我负责的是图表模块 `static/js/chart.js`，对外只有三个函数：

```js
BookApp.chart.pie(el, data, opts)    // 饼图 / 环形图
BookApp.chart.bar(el, data, opts)    // 柱状图
BookApp.chart.line(el, data, opts)   // 折线图
```

### 一、没用 Chart.js，自己写了 Canvas

组里原本的计划是把 Chart.js 下载到 `static/vendor/`，下载失败再手写 canvas。我直接选了手写，原因有三个：

1. 现场断网也能跑，不依赖 CDN；
2. 接口完全由我控制，不用去猜 Chart.js 的配置项；
3. Chart.js 会把 `window.Chart` 占成自己的构造函数，和我们约定的 `Chart.pie(...)` 撞名字，接的时候容易出玄学问题。

代价是要自己处理文字排版、坐标轴、命中检测这些脏活，总共 900 行左右。

### 二、数据归一化：让 6/7/8 号不用为我改代码

三个统计模块返回的字段名不一样——6 号给 `{period, income, expense}`，7 号给 `{category, amount, percent, count}`，8 号给 `{bucket, count}`。如果图表只认 `{label, value}`，他们每人就得写一个转换函数。

我改成在图表内部做兼容，把常见键名排成优先级依次取：

```js
function pick(obj) {
  for (var i = 1; i < arguments.length; i++) {
    var k = arguments[i];
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

var label = pick(d, 'label', 'period', 'category', 'bucket', 'name', 'x', 'date');
var value = pick(d, 'value', 'amount', 'count', 'total', 'balance', 'expense', 'income', 'y');
```

这样他们直接把接口返回值丢进来就能出图，字段对不上也不会崩（取不到值就当 0）。多系列折线则用 `opts.series` 指定画哪几个键：

```js
BookApp.chart.line(el, [{period:'11-01', income:8000, expense:230}], {
  series: [{ key:'income',  name:'收入', color:'#008300' },
           { key:'expense', name:'支出', color:'#e34948' }]
});
```

### 三、Canvas 不认 CSS 变量，而且它不报错

这是当天最坑的一个 bug。我给系列色传了 `'var(--viz-income)'`，想让图表颜色跟着 `style.css` 走。结果整条折线是**黑的**，还一段段断开。

原因是 Canvas 的 `strokeStyle` 被赋一个非法值时**不会抛错，也不会警告，直接静默保持上一次的颜色**（默认黑）。所以线上就成了一条黑线。更麻烦的是标记点：`fillStyle` 同样失效，但后面又画了 2px 的白色描边，于是每个点都在线上擦出一个小缺口，看起来像虚线。

修法是所有颜色统一过一道解析：

```js
function col(c) {
  if (!c) return '';
  c = String(c).trim();
  if (c.indexOf('var(') === 0) {
    var name = c.slice(4, c.indexOf(')')).trim();
    return global.getComputedStyle(document.documentElement)
                 .getPropertyValue(name).trim() || '';
  }
  return c;
}
```

教训：**Canvas 的 API 几乎不会给你报错**，画错了就是画错了，必须真的把图渲染出来看。

### 四、画布把自己的容器撑大了

另一个只有渲染出来才发现的 bug。10 号给的挂载点 `.chart-box` 是 `min-height: 240px`（不写死高度），我的画布是 `width:100%; height:100%`。结果图表变成 440px 高，把容器顶大了。

原因是 `<canvas>` 有 **2:1 的固有宽高比**（默认 300×150）。当 `width` 被撑到 880px、而 `height` 因为父容器高度是 auto 而失效时，浏览器按固有比例反推出 880 ÷ 2 = 440px。容器跟着长到 440，`ResizeObserver` 又拿 440 重画一次，形成「画布越大 → 容器越高」的反馈环。

修法很简单，但顺序很关键——**先把容器高度量下来，再把画布插进去**：

```js
var h0 = el.clientHeight;                 // 先量，此时容器里还没有画布
var canvas = document.createElement('canvas');
canvas.style.cssText = 'display:block;width:100%;height:' + (h0 || 260) + 'px';
el.appendChild(canvas);
```

之后每次重绘都用 `h0` 而不是再读 `el.clientHeight`，反馈环就断了。

### 五、配色不是凭感觉挑的

饼图最多 8 个分类，我用校验器跑了色盲模拟和对比度：

- 8 个分类色，明暗两套下相邻两色的色盲 ΔE 最小 9.1 / 8.4，正常视觉最小 19.6 / 19.3，都过线；
- 但**收入绿和支出红这一对，色盲 ΔE 只有 7.2**，属于「只有配了文字才允许用」的区间。

所以代码里强制：2 个以上系列必须有图例，饼图必须有图例 + 百分比，悬停提示里带分类名。红绿只是辅助，不能作为唯一区分手段。

---

## 团队编程体验

**接口先定，写起来才不打架。** 组长在 14:22 就把 `CONTRACT.md` 和全部空壳文件推上去了，每个文件里连函数签名和 TODO 都写好了。我开工时 `static/js/chart.js` 里已经躺着一个空壳，我只需要把 TODO 填掉——省掉了「先讨论一下接口叫什么」这一整轮。

**但约定和代码还是会对不上。** 分工文档里写的是 `Chart.pie(el, data)`，空壳文件里实际是 `const Chart = {...}; window.BookApp.chart = Chart`，也就是 `BookApp.chart`。我按文档写完之后才发现这个差异。最后两个都挂了，谁按哪种写法调用都能用。这件事让我体会到：**文档是人写的，代码是机器跑的，两边不一致时应该以能跑的那边为准，然后把文档改掉。**

**被上游卡住是常态。** 按依赖顺序，2 号的数据存储和 3 号的数据模型是所有人的地基，6/7/8 号等他们的接口，我等于等所有人。到 15:00 时 2 号的 `storage.py` 还没有提交，后面的链路就都卡着。我的应对不是干等——先把自己能控的部分做完（模块本身 + 用 mock 数据验证），再拿 `mock.js` 那 20 条假数据按 6/7/8 号约定的返回结构算了一遍，提前把自己的图跑通。**【补一句：你们实际是怎么沟通催进度的】**

**代码合并很快，问题都在合并之后。** 我的 PR #13 在 15:11 被合进 main，但真正的坑——黑线、440px——都是在我自己把页面渲染出来看的时候才发现的，不是写完就有的。所以后来我给自己定了一条：**改完图表一定要截图看一眼**，因为 Canvas 画错了不会报错，只会安静地画错。

---

## 三个可以直接写进「耗时事件」的点

1. **Canvas 静默失败**：`strokeStyle` 赋非法值不报错，折线变黑 + 标记点把线擦成虚线，排查靠读画布像素和渲染截图，花了约 20 分钟。
2. **画布撑大容器**：`<canvas>` 固有 2:1 比例导致容器从 240px 涨到 440px，且 `ResizeObserver` 会放大这个反馈，改了测量顺序才解决。
3. **接口名不一致**：分工文档写 `Chart.pie`，空壳代码是 `BookApp.chart`，靠同时挂两个名字兼容，避免了回头改 6/7/8 号的调用。
