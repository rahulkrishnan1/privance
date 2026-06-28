export function CadenceSuffix({ unit, className }: { unit: string; className?: string }) {
  return <span className={className}>{`/${unit}`}</span>;
}
