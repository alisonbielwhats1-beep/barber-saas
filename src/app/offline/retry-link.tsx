"use client";

/**
 * "Tentar novamente" recarrega a página que falhou. O service worker responde
 * a navegações sem rede com /offline, mas a barra de endereço continua na rota
 * original, então recarregar volta exatamente para ela (e não para a landing).
 *
 * O `href` vazio resolve para a URL atual e funciona mesmo se o JavaScript
 * desta página não carregar offline (o service worker só guarda o HTML).
 */
export function RetryLink({ className }: { className?: string }) {
  return (
    <a
      href=""
      onClick={(event) => {
        event.preventDefault();
        window.location.reload();
      }}
      className={className}
    >
      Tentar novamente
    </a>
  );
}
