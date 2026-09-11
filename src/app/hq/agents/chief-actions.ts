"use server";
import { askChief, loadChiefState } from "@/lib/hq/chief-service";
export async function askChiefAction(input:unknown) { return askChief(input); }
export async function chiefHistoryAction(cursor?:string) { return loadChiefState(cursor); }

