/**
 * Conversão de cor para o formato dos design tokens.
 *
 * Os tokens do projeto guardam a cor "crua" (`--primary: 152 65% 48%`) e o
 * Tailwind aplica `hsl(var(--primary))`. Isso permite opacidade via
 * `bg-primary/10`, mas significa que uma cor escolhida pelo dono (hex, vinda
 * do input `type="color"`) precisa virar a tripla `H S% L%` antes de entrar
 * como CSS variable.
 */

/** `#2ECC8B` → `152 65% 48%`. Devolve null se o hex for inválido. */
export function hexToHslTriple(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;

  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Luminância relativa (WCAG) para decidir o texto que fica por cima.
 * Sem isto, uma cor de marca clara deixaria o rótulo do botão ilegível.
 */
export function readableForeground(hex: string | null | undefined): string | null {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return null;
  const int = parseInt(m[1], 16);
  const chan = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  // 0,179 é o ponto em que preto e branco trocam de vantagem no critério
  // WCAG. Assim, pelo menos uma das duas opções mantém contraste AA.
  return lum > 0.179 ? "0 0% 10%" : "0 0% 100%";
}
