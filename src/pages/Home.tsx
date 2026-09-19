import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllPlans, savePlan, deletePlan } from '../db';
import { createEmptyPlan, clonePlan, generateId } from '../utils';
import type { Plan } from '../types';

export default function Home() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    getAllPlans().then(setPlans);
  }, []);

  const handleNew = async () => {
    const plan = createEmptyPlan();
    await savePlan(plan);
    navigate(`/plan/${plan.id}`);
  };

  const handleCopy = async (plan: Plan) => {
    const copy = clonePlan(plan);
    copy.id = generateId();
    copy.name = `${copy.name} 副本`;
    copy.updatedAt = Date.now();
    await savePlan(copy);
    setPlans(await getAllPlans());
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该方案？')) return;
    await deletePlan(id);
    setPlans(await getAllPlans());
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="home-container">
      <header className="home-header">
        <h1>婚宴座次编排器</h1>
        <button className="btn-primary" onClick={handleNew}>新建方案</button>
      </header>
      <div className="plans-list">
        {plans.length === 0 && (
          <div className="empty-state">
            <p>暂无方案，点击上方按钮创建</p>
          </div>
        )}
        {plans.map((plan) => (
          <div key={plan.id} className="plan-card" onClick={() => navigate(`/plan/${plan.id}`)}>
            <div className="plan-info">
              <h3>{plan.name}</h3>
              <p className="plan-meta">
                {plan.tables.length} 桌 · {plan.guests.length} 人 · 更新于 {formatDate(plan.updatedAt)}
              </p>
            </div>
            <div className="plan-actions" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => handleCopy(plan)}>复制</button>
              <button onClick={() => handleDelete(plan.id)}>删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
