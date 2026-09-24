import { NextRequest } from "next/server";
import { runReminders } from "../route";

export async function GET(req: NextRequest) {
  return runReminders(req, "today");
}
