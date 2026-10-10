/** Pede para abrir o painel da Secretária (menu do computador e aba do celular). */
export const SECRETARY_OPEN_EVENT = "everflair:secretary-open";

/**
 * O painel carrega depois da página: a marca no <html> guarda o pedido feito antes disso e o painel a atende ao montar
 * (e a apaga). Com o painel já montado, o evento abre na hora.
 */
export function openSecretary() {
  document.documentElement.setAttribute("data-secretary-requested", "");
  window.dispatchEvent(new Event(SECRETARY_OPEN_EVENT));
}
