import { describe, expect, it } from "vitest";
import {
  assertComandaDiscountAllowed,
  ComandaError,
} from "../comanda-service";
import { reserveAppointmentProducts } from "../appointment-product-service";

describe("permissões financeiras da comanda", () => {
  it("permite recepcionista concluir sem desconto", () => {
    expect(() => assertComandaDiscountAllowed("RECEPTIONIST", 0)).not.toThrow();
  });

  it("rejeita qualquer desconto positivo enviado por recepcionista", () => {
    expect(() => assertComandaDiscountAllowed("RECEPTIONIST", 1))
      .toThrowError(expect.objectContaining({ code: "DISCOUNT_FORBIDDEN" }));
  });

  it("rejeita também desconto de 100% enviado por recepcionista", () => {
    expect(() => assertComandaDiscountAllowed("RECEPTIONIST", 5_000))
      .toThrow(ComandaError);
  });

  it.each(["OWNER", "MANAGER"] as const)(
    "permite desconto integral para %s",
    (role) => {
      expect(() => assertComandaDiscountAllowed(role, 5_000)).not.toThrow();
    },
  );
});

describe("entrada do domínio de reserva de produtos", () => {
  it.each([0, -1, 1.5, 21])(
    "rejeita quantidade adversarial %s antes de tocar no banco",
    async (quantity) => {
      const tx = new Proxy({}, {
        get() {
          throw new Error("o banco não deveria ser consultado");
        },
      });
      await expect(reserveAppointmentProducts(tx as never, {
        salonId: "salon-a",
        appointmentId: "appointment-a",
        actorName: "Atacante",
        items: [{ productId: "product-a", quantity }],
      })).rejects.toMatchObject({ code: "PRODUCT_INVALID" });
    },
  );
});
