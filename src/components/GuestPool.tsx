import { useState } from 'react';
import type { Guest } from '../types';
import { generateId, parseGuestsText } from '../utils';
import { TAG_OPTIONS } from '../types';

interface Props {
  guests: Guest[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (guest: Guest) => void;
  onRemove: (guestId: string) => void;
  onDragStart: (id: string | null) => void;
  conflictMap: Map<string, string[]>;
  onUpdate?: (guest: Guest) => void;
}

export default function GuestPool({ guests, selectedId, onSelect, onAdd, onRemove, onDragStart, conflictMap, onUpdate }: Props) {
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [filterTag, setFilterTag] = useState<string>('');
  const [search, setSearch] = useState('');

  const handleImport = () => {
    const parsed = parseGuestsText(importText);
    for (const p of parsed) {
      const validTags = p.tags.filter((t) => TAG_OPTIONS.includes(t));
      onAdd({ id: generateId(), name: p.name, tags: validTags, partySize: 1 });
    }
    setImportText('');
    setShowImport(false);
  };

  const filtered = guests.filter((g) => {
    const matchTag = !filterTag || g.tags.includes(filterTag);
    const matchSearch = !search || g.name.includes(search);
    return matchTag && matchSearch;
  });

  const selectedGuest = guests.find((g) => g.id === selectedId);

  return (
    <div className="guest-pool">
      <h3>宾客池 ({guests.length})</h3>
      <div className="pool-actions">
        <button onClick={() => setShowImport((s) => !s)}>批量导入</button>
        <button onClick={() => onAdd({ id: generateId(), name: '新宾客', tags: [], partySize: 1 })}>添加宾客</button>
      </div>
      {showImport && (
        <div className="import-panel">
          <textarea
            placeholder="粘贴姓名，每行一个，可带标签（如：张三 男方亲属）"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={5}
          />
          <button onClick={handleImport}>确认导入</button>
        </div>
      )}
      <div className="pool-filters">
        <input placeholder="搜索姓名" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
          <option value="">全部标签</option>
          {TAG_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      {selectedGuest && onUpdate && (
        <div className="guest-editor">
          <label>
            姓名
            <input
              value={selectedGuest.name}
              onChange={(e) => onUpdate({ ...selectedGuest, name: e.target.value })}
            />
          </label>
          <label>
            人数
            <input
              type="number"
              min={1}
              max={10}
              value={selectedGuest.partySize}
              onChange={(e) => onUpdate({ ...selectedGuest, partySize: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
            />
          </label>
          <label>
            标签
            <div className="tag-checkboxes">
              {TAG_OPTIONS.map((tag) => (
                <label key={tag} className="tag-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedGuest.tags.includes(tag)}
                    onChange={(e) => {
                      const tags = e.target.checked
                        ? [...selectedGuest.tags, tag]
                        : selectedGuest.tags.filter((t) => t !== tag);
                      onUpdate({ ...selectedGuest, tags });
                    }}
                  />
                  {tag}
                </label>
              ))}
            </div>
          </label>
          <label>
            备注
            <input
              value={selectedGuest.note || ''}
              onChange={(e) => onUpdate({ ...selectedGuest, note: e.target.value })}
            />
          </label>
          <label className="child-seat-label">
            <input
              type="checkbox"
              checked={!!selectedGuest.childSeat}
              onChange={(e) => onUpdate({ ...selectedGuest, childSeat: e.target.checked })}
            />
            儿童椅
          </label>
        </div>
      )}
      <div className="guest-list">
        {filtered.map((g) => {
          const conflicts = conflictMap.get(g.id) || [];
          const isConflict = conflicts.length > 0;
          return (
            <div
              key={g.id}
              className={`guest-chip ${selectedId === g.id ? 'selected' : ''} ${isConflict ? 'conflict' : ''}`}
              draggable
              onDragStart={() => onDragStart(g.id)}
              onDragEnd={() => onDragStart(null)}
              onClick={() => onSelect(selectedId === g.id ? null : g.id)}
            >
              <span className="guest-name">{g.name}</span>
              {g.tags.length > 0 && <span className="guest-tags">{g.tags.join(', ')}</span>}
              {isConflict && (
                <span
                  className="conflict-badge"
                  title={`冲突: ${conflicts.map((c) => guests.find((gg) => gg.id === c)?.name || c).join(', ')}`}
                >!</span>
              )}
              <button className="guest-remove" onClick={(e) => { e.stopPropagation(); onRemove(g.id); }}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
