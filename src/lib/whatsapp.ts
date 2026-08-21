export function buildAppointmentWhatsAppLink(input: {
  phone: string | null;
  clientName: string;
  salonName: string;
  when: string;
  serviceName?: string;
  professionalName?: string;
}): string | null {
  const digits = input.phone?.replace(/\D/g, "") ?? "";
  if (digits.length < 10) return null;

  const fullNumber = digits.startsWith("55") && digits.length >= 12
    ? digits
    : `55${digits}`;
  const firstName = input.clientName.trim().split(/\s+/)[0] || "cliente";
  const details = [
    input.serviceName,
    input.professionalName ? `com ${input.professionalName}` : null,
  ].filter(Boolean).join(" · ");
  const message = [
    `Olá ${firstName}! Lembrando que seu horário é hoje às ${input.when} no ${input.salonName}.`,
    details ? `${details}.` : null,
    "Podemos confirmar? 💈",
  ].filter(Boolean).join(" ");

  return `https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`;
}
