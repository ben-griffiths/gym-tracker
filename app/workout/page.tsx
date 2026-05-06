import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<{ edit?: string | string[] }>;
};

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Legacy `/workout` and `/workout?edit=<id>` → canonical `/workout/new` or `/workout/<id>`. */
export default async function LegacyWorkoutIndex({ searchParams }: Props) {
  const sp = await searchParams;
  const raw = firstParam(sp.edit)?.trim();
  if (raw) {
    redirect(`/workout/${encodeURIComponent(raw)}`);
  }
  redirect("/workout/new");
}
