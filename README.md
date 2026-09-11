# Whiteboard bais alpha

> 一个可悬浮、可无限缩放、支持**笔迹录制回放**与**数学草稿**的白色画板。
> A floating whiteboard for recording, drawing, and mathematical drafts.

纯前端实现，零运行时依赖。既可在线打开（`index.html` + 静态服务器），也可构建为**单个 HTML 文件**双击离线使用。

## 特性

- 🖊️ **自由书写**：钢笔（压感 + 书写速度决定线宽）、荧光笔（叠加不加深）、橡皮（可只擦掉笔迹的一段）
-  **图形**：直线、箭头、矩形、椭圆（`Shift` 约束角度 / 正方形 / 正圆），可填充
- ✍️ **文字与便签**：画布上直接落字、拖出便签、双击再次编辑
- ➗ **数学草稿**：内置 LaTeX 速记 → Unicode 转换（离线，无需公式引擎），符号面板一键插入
- ⏺️ **录制与回放**：`F9` 录制，笔迹带时间轴，`F10` 按 0.5×–4× 速度回放
- 🧭 **无限画布**：滚轮缩放、双指捏合、Space/中键/抓手平移、框选、移动、缩放手柄、层级调整
- 💾 **持久化**：自动保存到浏览器 localStorage；可导出 / 导入 `.wbjson` 工程，导出 PNG / SVG，打印成 PDF
-  **三种板面**：纯白、护眼米色、深色墨板；UI 浅色/深色主题随板面切换
- 🖱️ **可拖动悬浮面板**：工具条、样式条、数学面板都可拖走、折叠

## 运行

```bash
# 开发（ES Module 页面需经 HTTP 打开）
npm run dev          # 启动 http://localhost:8000

# 构建单文件离线版（可双击直接打开）
npm install
npm run build        # 生成 dist/whiteboard.html

# 测试
npm test             # 纯逻辑单元测试（node:test）
npm run test:e2e     # 真实浏览器端到端（Playwright + 内置 Chromium 获取逻辑）
```

> `test:e2e` 在受限网络下会自动从 npm 包 `@sparticuz/chromium` 解出浏览器；
> 如本机已有 Chromium，可用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。

## 快捷键（节选）

| 按键 | 作用 |
| --- | --- |
| `V` `H` `P` `Y` `E` | 选择 / 抓手 / 钢笔 / 荧光笔 / 橡皮 |
| `L` `A` `R` `O` | 直线 / 箭头 / 矩形 / 椭圆 |
| `T` `N` `Z` | 文字 / 便签 / 激光笔 |
| `Space` + 拖动 | 平移画布 |
| 滚轮 / `Ctrl`+滚轮 | 缩放 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Ctrl+D` / `Ctrl+A` / `Del` | 复制 / 全选 / 删除 |
| `+` `-` `0` `1` | 放大 / 缩小 / 100% / 适应内容 |
| `G` / `Shift+G` / `M` | 网格 / 对齐网格 / 数学面板 |
| `F9` / `F10` | 录制 / 回放 |
| `Ctrl+S` / `Ctrl+P` | 导出工程 / 打印 |
| `?` | 帮助（完整列表） |

## 目录结构

```
index.html            页面骨架 + 图标精灵 + UI 面板
assets/whiteboard.css 全部样式（无外部依赖）
js/
  state.js            单一状态源、相机与坐标换算
  utils.js            通用工具（颜色 / 下载 / 事件）
  geometry.js         包围盒 / 命中测试 / 缩放映射
  model.js            元素模型 / 橡皮分割 / 复制
  text.js             文字测量 / 换行 / 缓存
  math.js             LaTeX→Unicode / 符号面板数据
  history.js          撤销 / 重做（快照）
  renderer.js         Canvas 场景渲染 / 网格 / 选择框
  editor.js           画布文字编辑浮层
  tools.js            指针交互状态机（绘制/选择/平移/缩放/橡皮/激光）
  playback.js         笔迹回放时间轴
  storage.js          localStorage 序列化 / 恢复
  export.js           导出 PNG / SVG / JSON / 打印
  ui.js               DOM 装配 / 快捷键 / 状态栏
  main.js             启动入口 + 调试入口 window.whiteboard
tools/
  serve.mjs           零依赖静态服务器
  build.mjs           esbuild 单文件构建
  unit.test.mjs       单元测试
  e2e.mjs             浏览器端到端测试
  browser.mjs         受限网络下的 Chromium 获取
```

## 数学草稿示例

在数学面板输入框里写 LaTeX 速记，例如：

```
\frac{-b \pm \sqrt{b^2-4ac}}{2a}   →   (-b ± √(b²-4ac))/(2a)
\sum_{i=1}^{n} i                    →   Σᵢ₌₁ⁿ i
\lim_{x \to 0} \frac{\sin x}{x}     →   lim_(x → 0) (sin x)/(x)
```

转换结果是可编辑的 Unicode 文本，落板后仍能用文字工具修改。

## 许可

Apache-2.0，见 [LICENSE](./LICENSE)。
