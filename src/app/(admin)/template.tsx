/**
 * Template remonta a cada navegação — é o que faz a transição de página
 * (fade + slide sutil) tocar em toda troca de rota, não só na primeira carga.
 */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
