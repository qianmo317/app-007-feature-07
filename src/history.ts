import type { Command, Guest, Plan, Rule } from './types';

export type HistoryEntry = {
  plan: Plan;
  label: string;
  ts: number;
  coalesceKey?: string;
};

export type PersistedHistory = {
  version: 1;
  past: HistoryEntry[];
  future: HistoryEntry[];
};

export type PushOptions = {
  /** 显式指定合并键；传 false 可禁止该命令的自动合并 */
  coalesceKey?: string | false;
  /** 直接指定这一步的人类可读描述 */
  label?: string;
};

export type HistoryManager = {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;
  undo: () => Plan | null;
  redo: () => Plan | null;
  push: (command: Command, options?: PushOptions) => void;
  current: () => Plan;
  serialize: () => PersistedHistory;
};

// 规格要求至少保留 50 步，这里放宽到 100 步
const MAX_HISTORY = 100;
// 同一合并键在该时间窗内的连续操作合成一条（一次拖动 / 一轮连续输入）
const COALESCE_MS = 1500;

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function applyCommand(plan: Plan, command: Command): Plan {
  const p = deepClone(plan);
  switch (command.type) {
    case 'updatePlan':
      return deepClone(command.plan);
    case 'updateTables':
      p.tables = deepClone(command.tables);
      break;
    case 'updateGuests':
      p.guests = deepClone(command.guests);
      break;
    case 'updateRules':
      p.rules = deepClone(command.rules);
      break;
    case 'updateTable': {
      const idx = p.tables.findIndex((t) => t.id === command.table.id);
      if (idx >= 0) p.tables[idx] = deepClone(command.table);
      break;
    }
    case 'addGuest':
      p.guests.push(deepClone(command.guest));
      break;
    case 'removeGuest': {
      p.guests = p.guests.filter((g) => g.id !== command.guestId);
      p.tables.forEach((t) => {
        t.seatOrder = t.seatOrder.filter((id) => id !== command.guestId);
      });
      p.rules = p.rules.filter((r) => r.a !== command.guestId && r.b !== command.guestId);
      break;
    }
    case 'addTable':
      p.tables.push(deepClone(command.table));
      break;
    case 'removeTable': {
      p.tables = p.tables.filter((t) => t.id !== command.tableId);
      break;
    }
    case 'moveGuest': {
      const { guestId, fromTableId, toTableId, toIndex } = command;
      if (fromTableId) {
        const ft = p.tables.find((t) => t.id === fromTableId);
        if (ft) ft.seatOrder = ft.seatOrder.filter((id) => id !== guestId);
      }
      if (toTableId) {
        const tt = p.tables.find((t) => t.id === toTableId);
        if (tt) {
          const existing = tt.seatOrder.filter((id) => id !== guestId);
          const idx = toIndex !== undefined ? Math.max(0, Math.min(toIndex, existing.length)) : existing.length;
          existing.splice(idx, 0, guestId);
          tt.seatOrder = existing;
        }
      }
      break;
    }
    case 'batch': {
      let result = p;
      for (const c of command.commands) {
        result = applyCommand(result, c);
      }
      return result;
    }
  }
  return p;
}

const RULE_TYPE_TEXT: Record<Rule['type'], string> = {
  together: '必须同桌',
  apart: '禁止同桌',
  adjacent: '必须相邻',
  separate: '必须分开',
};

function guestName(plan: Plan, id: string): string {
  return plan.guests.find((g) => g.id === id)?.name ?? '宾客';
}

function findSeat(plan: Plan, guestId: string) {
  for (const t of plan.tables) {
    const index = t.seatOrder.indexOf(guestId);
    if (index >= 0) return { table: t, index };
  }
  return null;
}

function shapeText(shape: Plan['tables'][number]['shape']): string {
  return shape === 'round' ? '圆桌' : '长条桌';
}

function ruleText(plan: Plan, rule: Rule): string {
  return `「${guestName(plan, rule.a)}」${RULE_TYPE_TEXT[rule.type]}「${guestName(plan, rule.b)}」`;
}

/** 比较两个宾客数组，返回新增 / 删除 / 被修改的宾客（按 id） */
function diffGuests(before: Guest[], after: Guest[]) {
  const added = after.filter((g) => !before.some((b) => b.id === g.id));
  const removed = before.filter((g) => !after.some((a) => a.id === g.id));
  const changed = after.filter((g) => {
    const b = before.find((x) => x.id === g.id);
    return !!b && JSON.stringify(b) !== JSON.stringify(g);
  });
  return { added, removed, changed };
}

function diffRules(before: Rule[], after: Rule[]) {
  const added = after.filter((r) => !before.some((b) => b.id === r.id));
  const removed = before.filter((r) => !after.some((a) => a.id === r.id));
  return { added, removed };
}

/** 基于操作前后的快照生成一句人话描述 */
function describeChange(before: Plan, after: Plan, command: Command): string {
  switch (command.type) {
    case 'addGuest':
      return `添加宾客「${command.guest.name}」`;
    case 'removeGuest':
      return `删除宾客「${guestName(before, command.guestId)}」`;
    case 'addTable':
      return `添加${shapeText(command.table.shape)}「${command.table.label}」`;
    case 'removeTable': {
      const t = before.tables.find((x) => x.id === command.tableId);
      return `删除桌子「${t?.label ?? '未知桌'}」`;
    }
    case 'moveGuest': {
      const name = guestName(after, command.guestId);
      const from = findSeat(before, command.guestId);
      const to = findSeat(after, command.guestId);
      if (!from && to) {
        return `安排「${name}」入座 ${to.table.label}（${to.index + 1} 号位）`;
      }
      if (from && !to) {
        return `把「${name}」从 ${from.table.label} 移回宾客池`;
      }
      if (from && to && from.table.id !== to.table.id) {
        return `把「${name}」从 ${from.table.label} 调到 ${to.table.label}（${to.index + 1} 号位）`;
      }
      if (from && to && from.index !== to.index) {
        return `在 ${from.table.label} 内把「${name}」调到 ${to.index + 1} 号位`;
      }
      return `调整「${name}」的座位`;
    }
    case 'updateTable': {
      const b = before.tables.find((t) => t.id === command.table.id);
      const a = after.tables.find((t) => t.id === command.table.id);
      if (!b || !a) return '更新桌子信息';
      const moved = b.x !== a.x || b.y !== a.y;
      const renamed = b.label !== a.label;
      const capacityChanged = b.capacity !== a.capacity;
      if (moved && !renamed && !capacityChanged) return `移动桌子「${a.label}」`;
      if (renamed && !moved && !capacityChanged) return `桌子改名：${b.label} → ${a.label}`;
      if (capacityChanged && !moved && !renamed) return `把「${a.label}」的人数改为 ${a.capacity}`;
      return `编辑桌子「${a.label}」`;
    }
    case 'updateTables':
      return '更新桌位布局';
    case 'updateGuests': {
      const { added, removed, changed } = diffGuests(before.guests, after.guests);
      const total = added.length + removed.length + changed.length;
      if (total === 1) {
        if (added.length === 1) return `添加宾客「${added[0].name}」`;
        if (removed.length === 1) return `删除宾客「${removed[0].name}」`;
        if (changed.length === 1) return `编辑宾客「${changed[0].name}」的信息`;
      }
      return total > 0 ? `批量更新 ${total} 位宾客信息` : '更新宾客信息';
    }
    case 'updateRules': {
      const { added, removed } = diffRules(before.rules, after.rules);
      if (added.length === 1 && removed.length === 0) return `添加规则：${ruleText(after, added[0])}`;
      if (removed.length === 1 && added.length === 0) return `删除规则：${ruleText(before, removed[0])}`;
      return '更新约束规则';
    }
    case 'updatePlan':
      if (before.name !== after.name) return `方案改名为「${after.name}」`;
      return '更新方案信息';
    case 'batch':
      return command.label ?? `批量操作（${command.commands.length} 步）`;
    default:
      return '编辑方案';
  }
}

/** 未显式指定合并键时，按命令类型推断一个默认合并键 */
function defaultCoalesceKey(command: Command, before: Plan): string | undefined {
  switch (command.type) {
    case 'moveGuest':
      // 同一个人连续换桌（拖到 A 又拖到 B）合成一条
      return `move-guest:${command.guestId}`;
    case 'updatePlan':
      return 'plan-rename';
    case 'updateGuests': {
      const { added, removed, changed } = diffGuests(before.guests, command.guests);
      if (added.length + removed.length + changed.length === 1) {
        const only = added[0] || removed[0] || changed[0];
        return `guest-edit:${only.id}`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

function createManagerFromStacks(past: HistoryEntry[], future: HistoryEntry[]): HistoryManager {
  return {
    canUndo: () => past.length > 1,
    canRedo: () => future.length > 0,
    undoLabel: () => (past.length > 1 ? past[past.length - 1].label : null),
    redoLabel: () => (future.length > 0 ? future[future.length - 1].label : null),
    undo: () => {
      if (past.length <= 1) return null;
      future.push(past.pop()!);
      return deepClone(past[past.length - 1].plan);
    },
    redo: () => {
      if (future.length === 0) return null;
      const entry = future.pop()!;
      past.push(entry);
      return deepClone(entry.plan);
    },
    push: (command, options) => {
      const currentPlan = past[past.length - 1].plan;
      const next = applyCommand(currentPlan, command);
      const now = Date.now();
      const explicit = options?.coalesceKey;
      const key =
        explicit === false ? undefined : (explicit ?? defaultCoalesceKey(command, currentPlan)) || undefined;
      const top = past[past.length - 1];
      const canCoalesce =
        future.length === 0 &&
        past.length >= 2 &&
        !!key &&
        top.coalesceKey === key &&
        now - top.ts <= COALESCE_MS;

      if (canCoalesce) {
        // 合并进上一条：以这一轮操作开始前的快照重新生成描述
        const base = past[past.length - 2].plan;
        past[past.length - 1] = {
          plan: next,
          label: options?.label ?? describeChange(base, next, command),
          ts: now,
          coalesceKey: key,
        };
      } else {
        past.push({
          plan: next,
          label: options?.label ?? describeChange(currentPlan, next, command),
          ts: now,
          coalesceKey: key,
        });
        if (past.length > MAX_HISTORY + 1) past.shift();
        // 撤回之后再做新操作，重做这条路立即断掉
        future = [];
      }
    },
    current: () => deepClone(past[past.length - 1].plan),
    serialize: () => ({ version: 1, past: deepClone(past), future: deepClone(future) }),
  };
}

export function createHistoryManager(initial: Plan): HistoryManager {
  const past: HistoryEntry[] = [
    { plan: deepClone(initial), label: '初始状态', ts: Date.now() },
  ];
  return createManagerFromStacks(past, []);
}

function isValidEntry(entry: unknown): entry is HistoryEntry {
  if (!entry || typeof entry !== 'object') return false;
  const e = entry as Record<string, unknown>;
  const plan = e.plan as Record<string, unknown> | undefined;
  return (
    !!plan &&
    Array.isArray(plan.tables) &&
    Array.isArray(plan.guests) &&
    Array.isArray(plan.rules)
  );
}

function normalizeEntry(entry: HistoryEntry): HistoryEntry {
  return {
    plan: deepClone(entry.plan),
    label: typeof entry.label === 'string' && entry.label ? entry.label : '编辑',
    ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
    ...(typeof entry.coalesceKey === 'string' ? { coalesceKey: entry.coalesceKey } : {}),
  };
}

/** 从 IndexedDB 恢复历史栈；数据不合法时返回 null（退化为全新历史） */
export function restoreHistoryManager(data: unknown): HistoryManager | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<PersistedHistory>;
  if (!Array.isArray(d.past) || d.past.length === 0 || !Array.isArray(d.future)) return null;
  const past = d.past.filter(isValidEntry).map(normalizeEntry);
  if (past.length === 0) return null;
  const future = d.future.filter(isValidEntry).map(normalizeEntry);
  return createManagerFromStacks(past, future);
}
