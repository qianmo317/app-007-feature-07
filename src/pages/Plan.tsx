import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getPlan, savePlan, getHistory, saveHistory, setRecentPlanId } from '../db';
import { createHistoryManager, restoreHistoryManager } from '../history';
import type { HistoryManager, PushOptions } from '../history';
import { getConflictMap, getTableStats } from '../utils';
import type { Plan as PlanType, Command } from '../types';
import GuestPool from '../components/GuestPool';
import Canvas from '../components/Canvas';
import RulesPanel from '../components/RulesPanel';
import StatsBar from '../components/StatsBar';

function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function PlanPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlanType | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [dragGuestId, setDragGuestId] = useState<string | null>(null);
  const historyRef = useRef<HistoryManager | null>(null);
  // 撤销栈的界面状态（按钮禁用态 + 每一步的人话描述）
  const [historyUI, setHistoryUI] = useState({ canUndo: false, canRedo: false, undoText: null as string | null, redoText: null as string | null });
  const [conflictMap, setConflictMap] = useState<Map<string, string[]>>(new Map());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncHistoryUI = useCallback(() => {
    const manager = historyRef.current;
    setHistoryUI({
      canUndo: !!manager?.canUndo(),
      canRedo: !!manager?.canRedo(),
      undoText: manager?.undoLabel() ?? null,
      redoText: manager?.redoLabel() ?? null,
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([getPlan(id), getHistory(id)]).then(([storedPlan, storedHistory]) => {
      if (cancelled) return;
      let manager: HistoryManager | null = null;
      // 历史栈里带有方案快照，恢复成功时以栈顶快照为准（保证可继续撤销）
      if (storedHistory) manager = restoreHistoryManager(storedHistory);
      if (manager) {
        historyRef.current = manager;
        setPlan(manager.current());
      } else if (storedPlan) {
        historyRef.current = createHistoryManager(storedPlan);
        setPlan(storedPlan);
        setRecentPlanId(id);
      } else {
        const fallback = { id, name: '未命名方案', tables: [], guests: [], rules: [], updatedAt: Date.now() };
        historyRef.current = createHistoryManager(fallback);
        setPlan(fallback);
      }
      syncHistoryUI();
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id, syncHistoryUI]);

  useEffect(() => {
    if (!plan || !id) return;
    setConflictMap(getConflictMap(plan));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePlan(plan);
      // 方案与撤销栈一起落盘，刷新后撤销/重做仍然可用
      if (historyRef.current) saveHistory(id, historyRef.current.serialize());
    }, 500);
  }, [plan, id]);

  const dispatch = useCallback((command: Command, options?: PushOptions) => {
    const manager = historyRef.current;
    if (!manager) return;
    manager.push(command, options);
    setPlan(manager.current());
    syncHistoryUI();
  }, [syncHistoryUI]);

  const handleUndo = useCallback(() => {
    const manager = historyRef.current;
    if (!manager || !manager.canUndo()) return;
    const p = manager.undo();
    if (p) {
      setPlan(p);
      syncHistoryUI();
    }
  }, [syncHistoryUI]);

  const handleRedo = useCallback(() => {
    const manager = historyRef.current;
    if (!manager || !manager.canRedo()) return;
    const p = manager.redo();
    if (p) {
      setPlan(p);
      syncHistoryUI();
    }
  }, [syncHistoryUI]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return; // 正在输入时不拦截，保留文本框原生撤销
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
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
  const { canUndo, canRedo, undoText, redoText } = historyUI;

  return (
    <div className="plan-page">
      <header className="plan-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate('/')}>返回</button>
          <input
            className="plan-name-input"
            value={plan.name}
            onChange={(e) => dispatch({ type: 'updatePlan', plan: { ...plan, name: e.target.value } })}
          />
        </div>
        <div className="header-actions">
          <div className="history-group">
            <div className="history-row">
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                title={canUndo ? `撤销：${undoText}（Ctrl+Z）` : '已经撤到头了'}
              >
                ↶ 撤销
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                title={canRedo ? `重做：${redoText}（Ctrl+Y）` : '已经重到头了'}
              >
                ↷ 重做
              </button>
            </div>
            <div className="history-hints">
              <span className={`history-hint ${canUndo ? '' : 'at-end'}`}>
                {canUndo ? `撤销：${undoText}` : '已经撤到头了'}
              </span>
              <span className={`history-hint ${canRedo ? '' : 'at-end'}`}>
                {canRedo ? `重做：${redoText}` : '已经重到头了'}
              </span>
            </div>
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
          onRemove={(gid) => dispatch({ type: 'removeGuest', guestId: gid })}
          onDragStart={setDragGuestId}
          conflictMap={conflictMap}
          onUpdate={(g) => {
            const guests = plan.guests.map((gg) => gg.id === g.id ? g : gg);
            dispatch({ type: 'updateGuests', guests });
          }}
          onBatchAdd={(list) =>
            dispatch(
              { type: 'batch', commands: list.map((g) => ({ type: 'addGuest', guest: g })), label: `批量导入 ${list.length} 位宾客` },
              { coalesceKey: false },
            )
          }
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
