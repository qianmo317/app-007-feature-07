import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPlan, savePlan, setRecentPlanId, getHistory, saveHistory } from '../db';
import { createHistoryManager } from '../history';
import type { HistoryStatus } from '../history';
import { getConflictMap, getTableStats } from '../utils';
import type { Plan as PlanType, DispatchFn } from '../types';
import GuestPool from '../components/GuestPool';
import Canvas from '../components/Canvas';
import RulesPanel from '../components/RulesPanel';
import StatsBar from '../components/StatsBar';

const EMPTY_STATUS: HistoryStatus = {
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  pastCount: 0,
  futureCount: 0,
};

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [dragGuestId, setDragGuestId] = useState<string | null>(null);
  const historyRef = useRef<ReturnType<typeof createHistoryManager> | null>(null);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>(EMPTY_STATUS);
  const [conflictMap, setConflictMap] = useState<Map<string, string[]>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshStatus = useCallback(() => {
    if (historyRef.current) setHistoryStatus(historyRef.current.getStatus());
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([getPlan(id), getHistory(id)]).then(([stored, snapshot]) => {
      if (cancelled) return;
      let base: PlanType;
      if (stored) {
        base = stored;
        setRecentPlanId(id);
      } else {
        base = { id, name: '未命名方案', tables: [], guests: [], rules: [], updatedAt: Date.now() };
      }
      historyRef.current = createHistoryManager(base, snapshot);
      setPlan(historyRef.current.current());
      setHistoryStatus(historyRef.current.getStatus());
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  // 方案与历史栈一起落盘，刷新页面后仍可继续撤销/重做
  useEffect(() => {
    if (!plan || !historyRef.current) return;
    setConflictMap(getConflictMap(plan));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePlan(plan);
      saveHistory(historyRef.current!.getSnapshot());
    }, 500);
  }, [plan]);

  const dispatch = useCallback<DispatchFn>((command, options) => {
    if (!historyRef.current) return;
    const current = historyRef.current.current();
    historyRef.current.push(current, command, options);
    setPlan(historyRef.current.current());
    refreshStatus();
  }, [refreshStatus]);

  const handleUndo = useCallback(() => {
    if (!historyRef.current) return;
    const p = historyRef.current.undo();
    if (p) {
      setPlan(p);
      refreshStatus();
    }
  }, [refreshStatus]);

  const handleRedo = useCallback(() => {
    if (!historyRef.current) return;
    const p = historyRef.current.redo();
    if (p) {
      setPlan(p);
      refreshStatus();
    }
  }, [refreshStatus]);

  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      // 输入框里保留浏览器原生撤销（撤销文字输入），其余场景接管
      if (isEditable(e.target)) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleUndo, handleRedo]);

  if (loading) return <div className="plan-loading">加载中...</div>;
  if (!plan) return <div className="plan-loading">方案不存在</div>;

  const stats = getTableStats(plan);

  return (
    <div className="plan-page">
      <header className="plan-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate('/')}>返回</button>
          <input
            className="plan-name-input"
            value={plan.name}
            onChange={(e) => dispatch(
              { type: 'updatePlan', plan: { ...plan, name: e.target.value } },
              { coalesceKey: `rename:${plan.id}`, coalesceWindowMs: 1000 },
            )}
          />
        </div>
        <div className="header-actions">
          <div className="history-bar">
            <button
              className="history-btn"
              onClick={handleUndo}
              disabled={!historyStatus.canUndo}
              title={historyStatus.canUndo ? `撤销：${historyStatus.undoLabel}（Ctrl+Z）` : '已经撤到头了'}
            >
              撤销
            </button>
            <span className={`history-hint ${historyStatus.canUndo ? '' : 'at-end'}`}>
              {historyStatus.canUndo
                ? `撤回：${historyStatus.undoLabel}`
                : '已经撤到头了'}
            </span>
            <button
              className="history-btn"
              onClick={handleRedo}
              disabled={!historyStatus.canRedo}
              title={historyStatus.canRedo ? `重做：${historyStatus.redoLabel}（Ctrl+Y）` : '已经重到头了'}
            >
              重做
            </button>
            <span className={`history-hint ${historyStatus.canRedo ? '' : 'at-end'}`}>
              {historyStatus.canRedo
                ? `重做：${historyStatus.redoLabel}`
                : '已经重到头了'}
            </span>
          </div>
          <button onClick={() => navigate(`/plan/${plan.id}/print`)}>打印 / 导出</button>
        </div>
      </header>
      <StatsBar stats={stats} />
      <div className="plan-body">
        <GuestPool
          guests={plan.guests}
          selectedId={selectedGuestId}
          onSelect={setSelectedGuestId}
          onAdd={(g) => dispatch({ type: 'addGuest', guest: g })}
          onBatchAdd={(gs) => {
            if (gs.length === 1) {
              dispatch({ type: 'addGuest', guest: gs[0] });
            } else if (gs.length > 1) {
              dispatch(
                { type: 'batch', commands: gs.map((g) => ({ type: 'addGuest', guest: g })) },
                { label: `批量导入 ${gs.length} 位宾客` },
              );
            }
          }}
          onRemove={(gid) => dispatch({ type: 'removeGuest', guestId: gid })}
          onDragStart={setDragGuestId}
          conflictMap={conflictMap}
          onUpdate={(g) => {
            const guests = plan.guests.map((gg) => gg.id === g.id ? g : gg);
            dispatch(
              { type: 'updateGuests', guests },
              { coalesceKey: `guest-edit:${g.id}`, coalesceWindowMs: 1000 },
            );
          }}
        />
        <Canvas
          plan={plan}
          dragGuestId={dragGuestId}
          setDragGuestId={setDragGuestId}
          conflictMap={conflictMap}
          dispatch={dispatch}
        />
        <RulesPanel
          plan={plan}
          dispatch={dispatch}
        />
      </div>
    </div>
  );
}
