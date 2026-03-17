export default function Toast({ message, type = 'success' }) {
  const bg = type === 'danger' ? 'bg-[#F85149]' : 'bg-[#3FB950]';
  return (
    <div className={`fixed bottom-6 right-6 ${bg} text-white px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl z-[200] animate-slide-up`}>
      {message}
    </div>
  );
}
