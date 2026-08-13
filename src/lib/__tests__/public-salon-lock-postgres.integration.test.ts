import { describe, expect, it, vi } from "vitest";
import { prisma } from "../prisma";
import { withApprovedSalon, withSalonBySlug } from "../prisma-tenant";

const describePostgres =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type BlockedActivity = {
  pid: number;
  waitEventType: string | null;
  blockers: number[];
};

async function waitForBlockedSuspension(
  applicationName: string,
  timeoutMs = 5_000,
): Promise<BlockedActivity> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const [activity] = await prisma.$queryRaw<BlockedActivity[]>`
      SELECT
        pid,
        wait_event_type AS "waitEventType",
        pg_blocking_pids(pid) AS blockers
      FROM pg_stat_activity
      WHERE application_name = ${applicationName}
        AND state = 'active'
    `;
    if (
      activity?.waitEventType === "Lock" &&
      activity.blockers.length > 0
    ) {
      return activity;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "O UPDATE de suspensão não apareceu bloqueado no PostgreSQL",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function fixture() {
  const suffix = crypto.randomUUID();
  return prisma.salon.create({
    data: {
      slug: `public-access-ci-${suffix}`,
      name: "Public access lock CI",
      timezone: "America/Sao_Paulo",
      accessStatus: "APPROVED",
      accessReviewedAt: new Date(),
    },
    select: { id: true, slug: true },
  });
}

async function proveSuspensionIsSerialized(
  salonId: string,
  access: (callback: () => Promise<string>) => Promise<string | null>,
) {
  const entered = deferred();
  const release = deferred();

  const publicOperation = access(async () => {
    entered.resolve();
    await release.promise;
    return "public-operation-finished";
  });
  await entered.promise;

  const applicationName = `salon-lock-ci-${crypto.randomUUID()}`;
  const suspension = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('application_name', ${applicationName}, true)
    `;
    return tx.salon.update({
      where: { id: salonId },
      data: { accessStatus: "SUSPENDED" },
      select: { accessStatus: true },
    });
  });

  // A barreira positiva observa o backend do UPDATE esperando por um lock e
  // confirma quem o bloqueia. Assim o teste não passa por mero atraso do pool.
  let blocked!: BlockedActivity;
  let statusWhilePublicCallbackWasRunning: { accessStatus: string } | undefined;
  let observationError: unknown;
  try {
    blocked = await waitForBlockedSuspension(applicationName);
    statusWhilePublicCallbackWasRunning = await prisma.salon.findUniqueOrThrow({
      where: { id: salonId },
      select: { accessStatus: true },
    });
  } catch (error) {
    observationError = error;
  } finally {
    release.resolve();
  }
  await expect(publicOperation).resolves.toBe("public-operation-finished");
  await expect(suspension).resolves.toEqual({ accessStatus: "SUSPENDED" });
  if (observationError) throw observationError;
  expect(blocked.waitEventType).toBe("Lock");
  expect(blocked.blockers.length).toBeGreaterThan(0);
  expect(statusWhilePublicCallbackWasRunning).toEqual({ accessStatus: "APPROVED" });
}

describePostgres("lock de acesso público vs suspensão concorrente", () => {
  it("withApprovedSalon mantém a aprovação estável durante todo o callback", async () => {
    const salon = await fixture();

    await proveSuspensionIsSerialized(salon.id, (callback) =>
      withApprovedSalon(salon.id, callback));

    const callbackAfterSuspension = vi.fn(async () => "should-not-run");
    await expect(withApprovedSalon(salon.id, callbackAfterSuspension))
      .resolves.toBeNull();
    expect(callbackAfterSuspension).not.toHaveBeenCalled();
  });

  it("withSalonBySlug mantém a aprovação estável durante todo o callback", async () => {
    const salon = await fixture();

    await proveSuspensionIsSerialized(salon.id, (callback) =>
      withSalonBySlug(salon.slug, callback));

    const callbackAfterSuspension = vi.fn(async () => "should-not-run");
    await expect(withSalonBySlug(salon.slug, callbackAfterSuspension))
      .resolves.toBeNull();
    expect(callbackAfterSuspension).not.toHaveBeenCalled();
  });
});
