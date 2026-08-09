/**
 * Cabeçalho padrão de página do admin: kicker + título + ações à direita.
 * `meta` renderiza acima do título (chips de período, datas etc.).
 */
export function PageHeader({
  kicker,
  title,
  description,
  meta,
  children,
}: {
  kicker?: string;
  title: string;
  description?: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {meta}
        {kicker && (
          <p className="experience-eyebrow mb-1 text-[10px] font-semibold uppercase tracking-[0.17em]">
            {kicker}
          </p>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-[13px] leading-5 text-muted-foreground sm:text-[14px]">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{children}</div>}
    </header>
  );
}
