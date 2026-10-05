# sologsb-1120 古钟表维修工序档案（gbclockrepair）

面向钟表修复师的工序档案台：为一台古董钟表建档，记录机芯型号、零件缺失与配换、拆解顺序、清洗润滑点位，以及修复后的走时测试数据。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21820**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1120/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{clock,part,lot,step,test}.ts
        ├── stores/{clock,part,lot,step}Store.ts
        ├── components/common/{StepSequence,RateChart,ClockCard,StateBadge}.vue
        ├── hooks/{useClockSearch,useRepairProgress,useLedger}.ts
        ├── pages/{ClockList,ClockDetail,StepForm,PartList,TestView}.vue
        └── utils/{db,inventory,sync,timeCalc,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/clocks` | 钟表台账：按种类/机芯/品相/年代区间筛选，按修复状态分栏 | Clock |
| `/clocks/:id` | 钟表详情：左侧机芯信息，右侧工序流与走时测试记录，可切零件清单 | Clock、RepairStep、TimekeepingTest、MovementPart |
| `/steps/new` | 新建维修工序：选步骤类型后动态出清洗液/油脂/力矩字段，顺序号冲突即报错 | RepairStep、MovementPart |
| `/parts` | 零件与配换清单：批号库存登记/核账/调容量、按批号汇总的领用账与逐笔明细、按磨损状态分组，内联修改用量与来源批号 | MovementPart、PartLot、RepairStep |
| `/tests/:clockId` | 走时测试录入与多方位均值计算，生成走时单文本 | TimekeepingTest |

`/` 重定向到 `/clocks`，未匹配路由同样兜底到 `/clocks`。

## 数据存储说明

- 数据库名 `gbclockrepair`，当前结构版本 **v3**（`localStorage['gbclockrepair:db-version']` 记录）。
- 五张表：`clocks`（钟表）、`parts`（机芯零件）、`lots`（来源批号库存）、`steps`（维修工序）、`tests`（走时测试）。
- v1 → v2 迁移：补齐老记录的 `state`、`partIds`、`torque`、`positions` 字段并新增索引。
- v2 → v3 迁移：新增 `lots` 表；把旧零件中已登记来源批号的配换件（非「保留」）按批号汇总**已用量**回填为「待核」库存（容量=已用量、余量 0），空批号旧记录不入库、不会被当成可用库存；核账后转为「在册」。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 台示范钟表、5 项零件、2 条在册批号库存、5 道工序与 1 次走时测试（两台钟的新发发条款共用只剩 1 枚的批号，可直接复现抢料）。

## 领用账规则（零件 × 工序 × 钟表）

- **占用时机**：只有「装配」工序点「完成」时才占用来源批号，按零件 `qtyNeeded` 实际用量计入；同一零件挂多道工序只记一次，清洗/润滑等工序不占料。
- **容量拦截**：完成前在单个 IndexedDB 读写事务内校验 `已占用 + 本次 ≤ 批号容量`，不足则整笔回滚并提示「批号 X 容量 N 件，已领用 M 件，还差 K 件」，步骤不会被标完成。
- **并发提交**：两个页签同时点最后一枚的完成时，IndexedDB 事务串行化提交，只有一方成功；失败方收到容量不足提示并自动刷新真实余量（跨页签通过 BroadcastChannel / storage 事件同步）。
- **回退与改量**：回退已完成的装配工序即释放该批占用；在零件清单修改用量或来源批号后，领用账与钟表修复进度实时重算（占用由已完成装配派生，不另存台账）。
- **无来源不发放**：换新/修配零件必须有已登记的在册批号；批号不存在、零件名与批号登记不符、批号处于「待核」状态时一律拒绝完成装配。

## 功能要点

- **顺序号不跳号**：新建工序时若顺序号大于「当前最大顺序号 + 1」直接报错并给出建议值；`<StepSequence>` 对缺口行标红。
- **工序排序**：支持「上移 / 下移」按钮与原生拖拽交换顺序，交换的是 `seq`。
- **工序完成 / 回退**：完成后写 `finishedAt`，回退后计入待办与回退计数。
- **双轴走时图**：`<RateChart>` 左轴日差 s/d、右轴摆幅 °，标注四方位读数与均值。
- **走时单导出**：按方位均值生成文本，可复制或下载 txt。
