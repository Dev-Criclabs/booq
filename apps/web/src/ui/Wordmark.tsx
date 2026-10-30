// The club wordmark in Cormorant Garamond, the only place that font is used (PRD palette D). The
// club's English name is data and is the wordmark in both languages, as on the T- boards: its first
// word large, the rest small beneath (HUNTER / TENNIS CLUB).
export function Wordmark({ name }: { name: string }) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return (
    <div className="wordmark" lang="en">
      <span className="w1">{first}</span>
      {rest.length ? <span className="w2">{rest.join(' ')}</span> : null}
    </div>
  );
}
