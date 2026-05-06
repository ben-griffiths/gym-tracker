import { WorkoutPageClient } from "../workout-page-client";

type Props = {
  params: Promise<{ sessionId: string }>;
};

export default async function WorkoutSessionPage({ params }: Props) {
  const { sessionId } = await params;
  return <WorkoutPageClient key={sessionId} routeSegment={sessionId} />;
}
