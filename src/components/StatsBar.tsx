export default function StatsBar({ stats }: { stats: { seated: number; capacity: number; emptySeats: number; totalGuests: number; unassignedCount: number } }) {
  return (
    <div className="stats-bar">
      <div className="stat-item">总宾客: <b>{stats.totalGuests}</b></div>
      <div className="stat-item">已入座: <b>{stats.seated}</b></div>
      <div className="stat-item">空座位: <b>{stats.emptySeats}</b></div>
      <div className="stat-item">未分配: <b style={{ color: stats.unassignedCount > 0 ? '#c0392b' : 'inherit' }}>{stats.unassignedCount}</b></div>
      <div className="stat-item">总容量: <b>{stats.capacity}</b></div>
    </div>
  );
}
