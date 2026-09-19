import type { Command, Plan } from './types';

export const HISTORY_LIMIT = 50; // 只保留最近 50 步

export type PushOptions = {
  /** 连续相同 key 的操作在时间窗内会合并成一条记录（如同一个人的连续拖动） */
  coalesceKey?: string;
  coalesceWindowMs?: number;
  /** 手动指定这一步的人话描述 */
  label?: string;
};

type Entry = {
  plan: Plan; // 该步执行后的方案快照
  command: Command;
  label: string;
  timestamp: number;
  coalesceKey?: string;
  coalesceWindowMs?: number;
  /** 合并链第一步的来源（用于描述「从哪儿挪到哪儿」） */
  moveOriginTableId?: string | null;
};

export type HistoryStatus = {
  canUndo: boolean;
  canRedo: boolean;
  /** 撤销这一步会撤回什么 */
  undoLabel: string | null;
  /** 重做这一步会重做什么 */
  redoLabel: string | null;
  pastCount: number;
  futureCount: number;
};

export type HistorySnapshot = {
  version: 1;
  planId: string;
  past: Entry[];
  future: Entry[];
  savedAt: number;
};

export type HistoryManager = {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => Plan | null;
  redo: () => Plan | null;
  push: (plan: Plan, command: Command, options?: PushOptions) => void;
  current: () => Plan;
  getStatus: () => HistoryStatus;
  getSnapshot: () => HistorySnapshot;
};

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function guestName(plan: Plan, guestId: string): string {
  return plan.guests.find((g) => g.id === guestId)?.name || '某位宾客';
}

function tableLabel(plan: Plan, tableId: string | null | undefined): string {
  if (!tableId) return '宾客池';
  return plan.tables.find((t) => t.id === tableId)?.label || '已删除的桌';
}

function describeMove(
  planBefore: Plan,
  guestId: string,
  fromTableId: string | null,
  toTableId: string | null,
): string {
  const name = guestName(planBefore, guestId);
  if (fromTableId === toTableId && fromTableId !== null) {
    return `调整 ${name} 在${tableLabel(planBefore, toTableId)}的座位位次`;
  }
  const from = tableLabel(planBefore, fromTableId);
  const to = tableLabel(planBefore, toTableId);
  if (!fromTableId && toTableId) return `把 ${name} 从宾客池安排到${to}`;
  if (fromTableId && !toTableId) return `把 ${name} 从${from}退回宾客池`;
  return `把 ${name} 从${from}挪到${to}`;
}

function describeCommand(planBefore: Plan, command: Command): string {
  switch (command.type) {
    case 'moveGuest':
      return describeMove(planBefore, command.guestId, command.fromTableId, command.toTableId);
    case 'addGuest':
      return `添加宾客「${command.guest.name}」`;
    case 'removeGuest':
      return `删除宾客「${guestName(planBefore, command.guestId)}」`;
    case 'addTable':
      return `添加${command.table.label}`;
    case 'removeTable':
      return `删除${tableLabel(planBefore, command.tableId)}`;
    case 'updateTable': {
      const before = planBefore.tables.find((t) => t.id === command.table.id);
      const after = command.table;
      if (before && before.label !== after.label) {
        return `把桌名「${before.label}」改为「${after.label}」`;
      }
      if (before && before.capacity !== after.capacity) {
        return `把${after.label}的人数上限改为 ${after.capacity}`;
      }
      if (before && (before.x !== after.x || before.y !== after.y)) {
        return `拖动${after.label}调整位置`;
      }
      return `修改${after.label}`;
    }
    case 'updateGuests':
      return '编辑宾客信息';
    case 'updateRules':
      return command.rules.length > planBefore.rules.length ? '添加约束规则' : '删除约束规则';
    case 'updatePlan':
      return command.plan.name !== planBefore.name ? '修改方案名称' : '修改方案';
    case 'updateTables':
      return '批量修改桌位';
    case 'batch':
      return command.commands.length > 0
        ? describeCommand(planBefore, command.commands[command.commands.length - 1])
        : '批量操作';
  }
}

/** 合并后重新生成描述（保留第一轮的起点、用最新一轮的内容） */
function describeMerged(
  planBefore: Plan,
  prev: Entry,
  nextCommand: Command,
): string {
  if (nextCommand.type === 'moveGuest') {
    return describeMove(
      planBefore,
      nextCommand.guestId,
      prev.moveOriginTableId ?? null,
      nextCommand.toTableId,
    );
  }
  // 改名 / 调容量等连续编辑：对照链起点重新描述
  if (
    nextCommand.type === 'updateTable' ||
    nextCommand.type === 'updatePlan' ||
    nextCommand.type === 'updateGuests'
  ) {
    return describeCommand(planBefore, nextCommand);
  }
  return prev.label;
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

export function createHistoryManager(
  initial: Plan,
  snapshot?: HistorySnapshot | null,
): HistoryManager {
  let past: Entry[];
  let future: Entry[];

  if (snapshot && isValidSnapshot(snapshot, initial)) {
    past = snapshot.past;
    future = snapshot.future;
  } else {
    past = [{
      plan: deepClone(initial),
      command: { type: 'updatePlan', plan: deepClone(initial) },
      label: '初始方案',
      timestamp: Date.now(),
    }];
    future = [];
  }

  // 撤销/重做之后的第一次新操作不允许并入旧记录，保证「退回重来后再动一下就断掉重做」的边界清晰
  let coalesceLocked = false;

  function isValidSnapshot(snap: HistorySnapshot, plan: Plan): boolean {
    return (
      snap.version === 1 &&
      snap.planId === plan.id &&
      Array.isArray(snap.past) &&
      snap.past.length > 0 &&
      Array.isArray(snap.future)
    );
  }

  return {
    canUndo: () => past.length > 1,
    canRedo: () => future.length > 0,

    undo: () => {
      if (past.length <= 1) return null;
      future.push(past.pop()!);
      coalesceLocked = true;
      return deepClone(past[past.length - 1].plan);
    },

    redo: () => {
      if (future.length === 0) return null;
      const entry = future.pop()!;
      past.push(entry);
      coalesceLocked = true;
      return deepClone(entry.plan);
    },

    push: (plan, command, options) => {
      const now = Date.now();
      const top = past[past.length - 1];
      const windowMs = options?.coalesceWindowMs ?? 1000;

      const canCoalesce =
        !coalesceLocked &&
        !!options?.coalesceKey &&
        !!top?.coalesceKey &&
        top.coalesceKey === options.coalesceKey &&
        now - top.timestamp <= (top.coalesceWindowMs ?? windowMs);

      if (canCoalesce && top) {
        const mergedPlan = applyCommand(plan, command);
        const planBefore = past.length > 1 ? past[past.length - 2].plan : top.plan;
        const mergedLabel =
          options.label ?? describeMerged(planBefore, top, command);
        top.plan = mergedPlan;
        top.command = command;
        top.label = mergedLabel;
        top.timestamp = now;
        if (command.type === 'moveGuest' && top.moveOriginTableId === undefined) {
          top.moveOriginTableId = command.fromTableId;
        }
      } else {
        const next: Entry = {
          plan: applyCommand(plan, command),
          command,
          label: options?.label ?? describeCommand(plan, command),
          timestamp: now,
          coalesceKey: options?.coalesceKey,
          coalesceWindowMs: options?.coalesceWindowMs,
        };
        if (command.type === 'moveGuest') next.moveOriginTableId = command.fromTableId;
        past.push(next);
        if (past.length > HISTORY_LIMIT + 1) past.shift();
      }

      // 只要产生了新动作，重做这条路就断掉
      future = [];
      coalesceLocked = false;
    },

    current: () => deepClone(past[past.length - 1].plan),

    getStatus: () => ({
      canUndo: past.length > 1,
      canRedo: future.length > 0,
      undoLabel: past.length > 1 ? past[past.length - 1].label : null,
      redoLabel: future.length > 0 ? future[future.length - 1].label : null,
      pastCount: past.length - 1,
      futureCount: future.length,
    }),

    getSnapshot: () => ({
      version: 1,
      planId: initial.id,
      past: deepClone(past),
      future: deepClone(future),
      savedAt: Date.now(),
    }),
  };
}
