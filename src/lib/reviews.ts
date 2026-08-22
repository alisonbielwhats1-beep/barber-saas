import { z } from "zod";
import type { Tx } from "./prisma-tenant";

export const REVIEW_COMMENT_MAX_LENGTH = 500;

export const clientReviewInputSchema = z.object({
  appointmentId: z.string().trim().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(REVIEW_COMMENT_MAX_LENGTH)
    .optional()
    .nullable()
    .transform((value) => value || null),
}).strict();

export type ClientReviewInput = z.infer<typeof clientReviewInputSchema>;

export type ReviewSummary = {
  average: number;
  count: number;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  clientName: string;
  serviceName: string;
};

export function buildReviewSummary(ratings: readonly number[]): ReviewSummary {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  const validRatings = ratings.filter(
    (rating): rating is 1 | 2 | 3 | 4 | 5 => Number.isInteger(rating) && rating >= 1 && rating <= 5,
  );
  for (const rating of validRatings) distribution[rating] += 1;
  const total = validRatings.reduce((sum, rating) => sum + rating, 0);
  return {
    average: validRatings.length > 0 ? Math.round((total / validRatings.length) * 10) / 10 : 0,
    count: validRatings.length,
    distribution,
  };
}

/** Exibe apenas nome e inicial do sobrenome; e-mail e telefone nunca são públicos. */
export function formatReviewClientName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Cliente";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts.at(-1)!.slice(0, 1).toUpperCase()}.`;
}

export async function getPublicReviewData(
  tx: Tx,
  salonId: string,
  limit = 3,
): Promise<{ summary: ReviewSummary; reviews: PublicReview[] }> {
  const where = { salonId, status: "PUBLISHED" as const };
  const [aggregate, reviews] = await Promise.all([
    tx.clientReview.aggregate({
      where,
      _avg: { rating: true },
      _count: { _all: true },
    }),
    tx.clientReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 20)),
      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,
        client: { select: { name: true } },
        appointment: { select: { service: { select: { name: true } } } },
      },
    }),
  ]);

  const average = aggregate._avg.rating ?? 0;
  const count = aggregate._count._all;
  const publicReviews = reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt.toISOString(),
    clientName: formatReviewClientName(review.client.name),
    serviceName: review.appointment.service.name,
  }));

  return {
    summary: {
      average: Math.round(average * 10) / 10,
      count,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    },
    reviews: publicReviews,
  };
}

export async function getReviewModerationData(tx: Tx, salonId: string) {
  const where = { salonId };
  const [aggregate, distribution, reviews] = await Promise.all([
    tx.clientReview.aggregate({
      where: { ...where, status: "PUBLISHED" },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    tx.clientReview.groupBy({
      by: ["rating"],
      where: { ...where, status: "PUBLISHED" },
      _count: { _all: true },
      orderBy: { rating: "asc" },
    }),
    tx.clientReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        rating: true,
        comment: true,
        status: true,
        createdAt: true,
        moderatedAt: true,
        client: { select: { name: true } },
        appointment: {
          select: {
            startAt: true,
            service: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  const ratings = distribution.reduce<number[]>((all, row) => {
    return all.concat(Array.from({ length: row._count._all }, () => row.rating));
  }, []);

  return {
    summary: {
      average: Math.round((aggregate._avg.rating ?? 0) * 10) / 10,
      count: aggregate._count._all,
      distribution: buildReviewSummary(ratings).distribution,
    } satisfies ReviewSummary,
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      status: review.status,
      createdAt: review.createdAt.toISOString(),
      moderatedAt: review.moderatedAt?.toISOString() ?? null,
      // O painel do estabelecimento é autenticado; aqui o dono precisa
      // identificar o cliente para tratar um caso real sem procurar no CRM.
      clientName: review.client.name,
      serviceName: review.appointment.service.name,
      appointmentStartAt: review.appointment.startAt.toISOString(),
    })),
  };
}
