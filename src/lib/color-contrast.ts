/** WCAG relative luminance: choose the readable foreground for a user color. */
export function contrastForeground(hex: string): "#000000" | "#ffffff" {
  if (!/^#[\da-f]{6}$/i.test(hex)) return "#ffffff";
  const channels = [1, 3, 5].map(start => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}
