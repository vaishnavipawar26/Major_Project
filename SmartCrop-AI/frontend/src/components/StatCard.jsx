/** Summary tile: icon, label, big value and caption. `loading` shows a skeleton in place of the value. */
export default function StatCard({ icon: Icon, label, value, sub, loading = false }) {
  return (
    <div className="card stat">
      {Icon && <span className="stat-icon" aria-hidden="true"><Icon size={20} /></span>}
      <div className="stat-body">
        <span className="stat-label">{label}</span>
        {loading
          ? <span className="skeleton stat-skeleton" aria-label="Loading" />
          : <span className="stat-value num">{value}</span>}
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  );
}
