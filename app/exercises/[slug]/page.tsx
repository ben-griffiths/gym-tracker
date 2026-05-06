import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExerciseDetailView } from "@/components/exercises/exercise-detail-view";
import { getExerciseBySlug } from "@/lib/exercises";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const exercise = getExerciseBySlug(slug);
  if (!exercise) {
    return { title: "Exercise" };
  }
  return {
    title: `${exercise.name} · LiftLog`,
    description:
      exercise.guide?.intro ??
      `${exercise.name} — standards and training notes in LiftLog.`,
  };
}

export default async function ExerciseDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const exercise = getExerciseBySlug(slug);
  if (!exercise) {
    notFound();
  }

  return <ExerciseDetailView exercise={exercise} />;
}
