export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--ledger)" />
      <path d="M9 9.5h14M9 14h14M9 18.5h8" stroke="var(--paper)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="21.5" cy="21.5" r="5" fill="var(--saffron)" />
      <path d="m19.3 21.6 1.5 1.5 2.9-3" stroke="var(--ledger)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
