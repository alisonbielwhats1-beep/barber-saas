/**
 * Cookie com a preferência de menu lateral recolhido. Fica fora do módulo "use client": o layout (servidor) lê o
 * valor de verdade; importado de um módulo de cliente, o servidor receberia só uma referência e nunca acharia o cookie.
 */
export const SIDEBAR_COOKIE = "admin-sidebar";
