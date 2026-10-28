import { searchLibrary } from "@/lib/data/overview";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const url = new URL(request.url);
  const course = url.searchParams.get("courseId");
  return searchLibrary({
    q: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    courseId: course ? Number.parseInt(course, 10) : undefined,
  });
});
