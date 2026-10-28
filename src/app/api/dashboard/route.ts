import { getDashboard } from "@/lib/data/overview";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => getDashboard());
