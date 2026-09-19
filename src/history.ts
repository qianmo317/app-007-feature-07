import type { Command, Plan } from './types';

export type HistoryManager = {
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => Plan | null;
  redo: () => Plan | null;
  push: (plan: Plan, command: Command) => void;
  current: () => Plan;
};

export function createHistoryManager(initial: Plan): HistoryManager {
  let past: Plan[] = [deepClone(initial)];
  let future: Plan[] = [];

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

  return {
    canUndo: () => past.length > 1,
    canRedo: () => future.length > 0,
    undo: () => {
      if (past.length <= 1) return null;
      future.push(past.pop()!);
      return deepClone(past[past.length - 1]);
    },
    redo: () => {
      if (future.length === 0) return null;
      const p = future.pop()!;
      past.push(p);
      return deepClone(p);
    },
    push: (plan, command) => {
      const next = applyCommand(plan, command);
      past.push(next);
      if (past.length > 51) past.shift();
      future = [];
    },
    current: () => deepClone(past[past.length - 1]),
  };
}
