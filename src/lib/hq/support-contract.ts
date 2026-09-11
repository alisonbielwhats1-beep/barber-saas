import { z } from "zod";
import type { ChiefRun } from "./chief-contract";
export const supportDraftSchema=z.object({reply:z.string().trim().min(1).max(1800),title:z.string().trim().min(1).max(120),category:z.enum(["Dúvida","Suporte","Bug","Financeiro","Outro"]),recommendation:z.enum(["reply","ticket","bug","feature","human"]),needsHuman:z.boolean(),reason:z.string().max(500),articleIds:z.array(z.string().max(80)).max(4)}).strict();
export type SupportDraft=z.infer<typeof supportDraftSchema>;
export type SupportReview={decision:string;text:string;targetId:string|null;targetType:string|null};
export type SupportRun=ChiefRun&{draft:SupportDraft|null;review:SupportReview|null};
export type SupportState={ready:boolean;reason:string;budgetMicros:number;committedMicros:number;customerId:string|null;customers:{id:string;business:string}[];customersLimited:boolean;runs:SupportRun[];nextCursor:string|null;context:{business:string;status:string;tickets:number;activities:number}|null};
export const supportReviewSchema=z.object({runId:z.string().uuid(),customerId:z.string().uuid(),decision:z.enum(["reply","ticket","bug","feature","discard"]),text:z.string().trim().min(3).max(4000),title:z.string().trim().min(3).max(120),category:z.enum(["Dúvida","Suporte","Bug","Financeiro","Outro"]),priority:z.enum(["Baixa","Média","Alta","Crítica"]),existingId:z.string().uuid().optional()}).strict();

