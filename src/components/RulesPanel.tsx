import { useState } from 'react';
import type { Plan, Rule, Command, RuleType } from '../types';
import { generateId } from '../utils';

interface Props {
  plan: Plan;
  dispatch: (cmd: Command) => void;
}

export default function RulesPanel({ plan, dispatch }: Props) {
  const [type, setType] = useState<RuleType>('together');
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');

  const addRule = () => {
    if (!aId || !bId || aId === bId) return;
    const rule: Rule = { id: generateId(), type, a: aId, b: bId };
    dispatch({ type: 'updateRules', rules: [...plan.rules, rule] });
    setAId('');
    setBId('');
  };

  const removeRule = (id: string) => {
    dispatch({ type: 'updateRules', rules: plan.rules.filter((r) => r.id !== id) });
  };

  const getName = (id: string) => plan.guests.find((g) => g.id === id)?.name || id;

  return (
    <div className="rules-panel">
      <h3>约束规则</h3>
      <div className="rule-form">
        <select value={type} onChange={(e) => setType(e.target.value as RuleType)}>
          <option value="together">必须同桌</option>
          <option value="apart">禁止同桌</option>
          <option value="adjacent">必须相邻</option>
          <option value="separate">必须分开</option>
        </select>
        <select value={aId} onChange={(e) => setAId(e.target.value)}>
          <option value="">选择宾客 A</option>
          {plan.guests.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <select value={bId} onChange={(e) => setBId(e.target.value)}>
          <option value="">选择宾客 B</option>
          {plan.guests.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <button onClick={addRule}>添加</button>
      </div>
      <div className="rules-list">
        {plan.rules.map((r) => (
          <div key={r.id} className="rule-item">
            <span className={`rule-type ${r.type}`}>
              {r.type === 'together' ? '必须同桌' : r.type === 'apart' ? '禁止同桌' : r.type === 'adjacent' ? '必须相邻' : '必须分开'}
            </span>
            <span>{getName(r.a)}</span>
            <span>↔</span>
            <span>{getName(r.b)}</span>
            <button onClick={() => removeRule(r.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
