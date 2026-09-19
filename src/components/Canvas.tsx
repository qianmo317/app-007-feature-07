import { useState, useRef, useEffect } from 'react';
import type { Plan, Table, DispatchFn } from '../types';
import { generateId } from '../utils';

interface Props {
  plan: Plan;
  dragGuestId: string | null;
  setDragGuestId: (id: string | null) => void;
  conflictMap: Map<string, string[]>;
  dispatch: DispatchFn;
}

export default function Canvas({ plan, dragGuestId, setDragGuestId, conflictMap, dispatch }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [showTableMenu, setShowTableMenu] = useState<{ x: number; y: number } | null>(null);

  // 拖动桌位：拖动过程中只在本地跟手（不污染历史栈），松手时提交一条
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number }>>({});
  const livePosRef = useRef<Record<string, { x: number; y: number }>>({});
  const dragState = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;
      const x = Math.max(0, e.clientX - ds.offsetX);
      const y = Math.max(0, e.clientY - ds.offsetY);
      livePosRef.current[ds.id] = { x, y };
      setLivePos((prev) => ({ ...prev, [ds.id]: { x, y } }));
    };
    const onUp = () => {
      const ds = dragState.current;
      if (ds) {
        const pos = livePosRef.current[ds.id];
        const table = plan.tables.find((t) => t.id === ds.id);
        if (pos && table && (pos.x !== table.x || pos.y !== table.y)) {
          dispatch(
            { type: 'updateTable', table: { ...table, x: pos.x, y: pos.y } },
            { coalesceKey: `table-move:${ds.id}`, coalesceWindowMs: 600 },
          );
        }
        delete livePosRef.current[ds.id];
        setLivePos((prev) => {
          if (!(ds.id in prev)) return prev;
          const next = { ...prev };
          delete next[ds.id];
          return next;
        });
      }
      dragState.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [plan, dispatch]);

  const handleDropOnCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragGuestId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const table = plan.tables.find((t) => {
      const tx = t.x, ty = t.y;
      const w = t.shape === 'round' ? 120 : 160;
      const h = t.shape === 'round' ? 120 : 100;
      return x >= tx && x <= tx + w && y >= ty && y <= ty + h;
    });
    if (table) {
      const fromTable = plan.tables.find((t) => t.seatOrder.includes(dragGuestId));
      if (fromTable?.id === table.id) return;
      if (table.seatOrder.length >= table.capacity) {
        alert('该桌已满');
        return;
      }
      dispatch(
        {
          type: 'moveGuest',
          guestId: dragGuestId,
          fromTableId: fromTable?.id || null,
          toTableId: table.id,
        },
        // 同一个人的连续拖动（2 秒内）合成一条撤销记录
        { coalesceKey: `move-guest:${dragGuestId}`, coalesceWindowMs: 2000 },
      );
    }
    setDragGuestId(null);
  };

  const handleTableMouseDown = (e: React.MouseEvent, table: Table) => {
    if ((e.target as HTMLElement).closest('.table-seats, .table-actions, .table-capacity-edit, input, button')) return;
    setSelectedTableId(table.id);
    dragState.current = { id: table.id, offsetX: e.clientX - table.x, offsetY: e.clientY - table.y };
  };

  const addTable = (shape: 'round' | 'rect') => {
    const id = generateId();
    const count = plan.tables.filter((t) => t.shape === shape).length + 1;
    const table: Table = {
      id,
      label: `${shape === 'round' ? '圆' : '长'}桌${count}`,
      x: 50 + (plan.tables.length % 5) * 180,
      y: 50 + Math.floor(plan.tables.length / 5) * 160,
      shape,
      capacity: shape === 'round' ? 10 : 10,
      seatOrder: [],
    };
    dispatch({ type: 'addTable', table });
  };

  const removeTable = (tableId: string) => {
    if (!confirm('确定删除该桌？')) return;
    dispatch({ type: 'removeTable', tableId });
    setSelectedTableId(null);
  };

  const handleSeatDrop = (tableId: string, index: number) => {
    if (!dragGuestId) return;
    const fromTable = plan.tables.find((t) => t.seatOrder.includes(dragGuestId));
    const toTable = plan.tables.find((t) => t.id === tableId)!;
    const moveOpts = { coalesceKey: `move-guest:${dragGuestId}`, coalesceWindowMs: 2000 };
    if (toTable.seatOrder.includes(dragGuestId)) {
      // reorder within same table
      dispatch({ type: 'moveGuest', guestId: dragGuestId, fromTableId: tableId, toTableId: tableId, toIndex: index }, moveOpts);
    } else {
      if (toTable.seatOrder.length >= toTable.capacity) {
        alert('该桌已满');
        return;
      }
      dispatch({ type: 'moveGuest', guestId: dragGuestId, fromTableId: fromTable?.id || null, toTableId: tableId, toIndex: index }, moveOpts);
    }
    setDragGuestId(null);
  };

  return (
    <div className="canvas-panel">
      <div className="canvas-toolbar">
        <button onClick={() => addTable('round')}>+ 圆桌</button>
        <button onClick={() => addTable('rect')}>+ 长条桌</button>
      </div>
      <div
        className="canvas-area"
        ref={canvasRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropOnCanvas}
        onContextMenu={(e) => { e.preventDefault(); setShowTableMenu({ x: e.clientX, y: e.clientY }); }}
        onClick={() => { setSelectedTableId(null); setShowTableMenu(null); }}
      >
        {plan.tables.map((table) => {
          const isSelected = selectedTableId === table.id;
          const isFull = table.seatOrder.length >= table.capacity;
          const live = livePos[table.id];
          const renderX = live?.x ?? table.x;
          const renderY = live?.y ?? table.y;
          return (
            <div
              key={table.id}
              className={`table-item ${table.shape} ${isSelected ? 'selected' : ''} ${isFull ? 'full' : ''}`}
              style={{ left: renderX, top: renderY }}
              onMouseDown={(e) => handleTableMouseDown(e, table)}
            >
              <div className="table-label">
                {isSelected ? (
                  <input
                    value={table.label}
                    onChange={(e) => dispatch(
                      { type: 'updateTable', table: { ...table, label: e.target.value } },
                      { coalesceKey: `table-label:${table.id}`, coalesceWindowMs: 1000 },
                    )}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ width: 80, fontSize: 13 }}
                  />
                ) : (
                  <>{table.label} ({table.seatOrder.length}/{table.capacity})</>
                )}
              </div>
              {isSelected && (
                <div className="table-capacity-edit" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                  人数:
                  <input
                    type="number"
                    value={table.capacity}
                    min={table.seatOrder.length}
                    max={20}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || table.capacity;
                      dispatch(
                        { type: 'updateTable', table: { ...table, capacity: Math.max(table.seatOrder.length, Math.min(20, val)) } },
                        { coalesceKey: `table-capacity:${table.id}`, coalesceWindowMs: 800 },
                      );
                    }}
                    style={{ width: 40, marginLeft: 4 }}
                  />
                </div>
              )}
              <div className="table-seats">
                {Array.from({ length: table.capacity }).map((_, i) => {
                  const gid = table.seatOrder[i];
                  const guest = gid ? plan.guests.find((g) => g.id === gid) : null;
                  const conflicts = gid ? conflictMap.get(gid) || [] : [];
                  const isConflict = conflicts.length > 0;
                  return (
                    <div
                      key={i}
                      className={`seat-cell ${gid ? 'occupied' : 'empty'} ${isConflict ? 'conflict' : ''}`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.stopPropagation(); handleSeatDrop(table.id, i); }}
                      onClick={(e) => { e.stopPropagation(); }}
                    >
                      {guest ? (
                        <>
                          <span className="seat-name">{guest.name}</span>
                          {isConflict && <span className="seat-conflict">!</span>}
                        </>
                      ) : (
                        <span className="seat-empty">{i + 1}号</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {isSelected && (
                <div className="table-actions">
                  <button onClick={(e) => { e.stopPropagation(); removeTable(table.id); }}>删除</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {showTableMenu && (
        <div className="context-menu" style={{ left: showTableMenu.x, top: showTableMenu.y }}>
          <div onClick={() => { addTable('round'); setShowTableMenu(null); }}>添加圆桌</div>
          <div onClick={() => { addTable('rect'); setShowTableMenu(null); }}>添加长条桌</div>
        </div>
      )}
    </div>
  );
}
