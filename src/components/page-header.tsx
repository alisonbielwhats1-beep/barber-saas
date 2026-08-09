/**
 * Cabeçalho padrão de página do admin: kicker + título + ações à direita.
 * `meta` renderiza acima do título (chips de período, datas etc.).
 */
export function PageHeader({
  kicker,
  title,
  meta,
  children,
}: {
  kicker?: string;
  title: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {meta}
        {kicker && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            {kicker}
          </p>
        )}
        <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </header>
  );
}
