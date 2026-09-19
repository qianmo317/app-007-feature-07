# 婚宴座次编排器 · Wedding Seating Planner

> 类型：前端 Web 应用｜难度：★★★｜纯前端（localStorage / IndexedDB）｜建议技术栈：React + TypeScript + Vite + Konva / SVG 拖拽

## 1. 一句话简介
把「谁和谁不能坐一桌、主桌怎么排、桌牌怎么写」变成可视化拖拽编排，并一键生成现场摆放图与签到表。

## 2. 真实场景与痛点
中式婚宴通常 10~40 桌，新人家里靠纸笔和微信群安排座位：
- 亲戚辈分、亲疏、前任/矛盾关系、单位同事分桌都是雷区，改一版就全乱。
- 主桌（父母、证婚人、伴郎伴娘）位次有讲究，坐错很尴尬。
- 临时有人不来/带家属，桌数和人名对不上，酒店方也拿不到清晰图。

## 3. 目标用户
- 正在筹备婚宴的新人及伴郎伴娘（无专业策划）。
- 农村/县城流水席的「管事人」。

## 4. 核心功能（MVP）
1. **宴会厅画布**：拖入圆桌/长条桌，设置桌号、每桌人数上限（默认 10）。
2. **宾客池**：批量粘贴姓名导入，支持标签（男方亲属 / 女方亲属 / 同事 / 同学 / 儿童 / 素食）。
3. **拖拽分桌**：从左侧宾客池拖到座位格；座位格按「主位朝向」自动排布位次（1 号位=主位）。
4. **约束规则**：设置「必须同桌」「禁止同桌」「必须相邻」「必须分开」，冲突实时红框告警。
5. **容量校验**：超员、空位、未分配人数顶部常驻统计条。
6. **导出**：座位总图（PNG/PDF）、每桌桌牌（含姓名+位次，可直接打印 A4 四宫格）、签到表（按姓氏排序）。

## 5. 进阶功能
- 多方案版本对比（方案 A/B，人数变化后一键回滚）。
- 「带家属」按 1.5 人占位/儿童椅单独标记。
- 伴郎伴娘分工视图、婚车/迎亲车队座位单独编排。
- 分享链接（把方案编码进 URL hash，无需后端）。

## 6. 页面结构
```
/            方案列表（新建 / 复制 / 删除）
/plan/:id    主工作台：左侧宾客池 | 中间宴会厅画布 | 右侧规则与统计
/plan/:id/print  打印视图（桌牌 / 座位图 / 签到表，@media print 优化）
```

## 7. 数据模型
```ts
type Guest  = { id: string; name: string; tags: string[]; partySize: number; childSeat?: boolean; note?: string };
type Table  = { id: string; label: string; x: number; y: number; shape: 'round'|'rect'; capacity: number; seatOrder: string[] };
type Rule   = { id: string; type: 'together'|'apart'|'adjacent'|'separate'; a: string; b: string };
type Plan   = { id: string; name: string; tables: Table[]; guests: Guest[]; rules: Rule[]; updatedAt: number };
```

## 8. 关键算法
- **位次排布**：按桌主位角度顺时针生成 `seat[0..n-1]`，主位 = 面向舞台方向。
- **规则求解**：把所有「禁止同桌」建图后做贪心着色 + 局部交换（模拟退火 2-opt），目标函数 = 冲突数×100 + 空位方差。
- **持久化**：IndexedDB 存方案，localStorage 存最近打开。

## 9. 交互与视觉要点
- 中国红 + 香槟金配色，圆桌用描边 + 阴影表现层次；拖动时半透明残影。
- 冲突宾客人像/姓名块闪红并弹出「与谁冲突」气泡。
- 关键操作支持 Ctrl+Z / Ctrl+Y（自建命令栈，至少 50 步）。

## 10. 验收标准
- 40 桌 / 400 人方案在普通笔记本上拖动保持 60fps（虚拟化渲染 + requestAnimationFrame）。
- 导入 400 人 CSV/粘贴文本 < 1s。
- 刷新页面后方案完整恢复；打印预览桌牌无错位、无裁切。

## 11. 边界（刻意不做）
不做在线礼金/请柬群发、不做酒店预订与订单、不做账号体系与多端同步——避开黑名单中的电商订单、预约系统类玩法。

## 12. 容器化与构建（Docker）

本项目交付**必须能通过 Docker 构建与运行**，验收一律以容器内运行结果为准，不接受只在本机 `npm run dev` 演示。

- **Dockerfile（多阶段）**
  - `builder`：`node:20-alpine` → `npm ci` → `npm run build`，产物 `dist/`
  - `runtime`：`nginx:1.27-alpine`，仅拷贝 `dist/` 与 `nginx.conf`，不含 node 与源码
- **docker-compose.yml**：服务名 `app-007`，端口 `8087:80`，`restart: unless-stopped`
- **nginx.conf**
  - SPA 回退：`try_files $uri $uri/ /index.html`
  - 带哈希的静态资源：`Cache-Control: public, max-age=31536000, immutable`
  - `index.html` 与 `sw.js`：`no-cache`
  - 开启 gzip（js/css/json/svg）
- **健康检查**：`HEALTHCHECK` 请求 `/healthz`（返回 200 的空文件）
- **字体依赖**：中文字体以 `@font-face` 本地打包，禁止运行时请求外网 CDN（容器内无外网也能正常显示）

```bash
docker compose up -d --build     # 构建并后台启动
docker compose logs -f           # 查看日志
docker compose down              # 停止并清理
```

- **验收**：`http://localhost:8087` 可用全部功能；40 桌方案拖动仍 60fps；`docker compose up -d --build` 一条命令从零起容器成功，镜像体积 < 60MB。
