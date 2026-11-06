export const Arrow = ({ className = "arr" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M1 8h13M9 3l5 5-5 5" />
  </svg>
);
export const Chevron = () => (
  <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M2 5.5l6 6 6-6" />
  </svg>
);
