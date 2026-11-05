import { redirect } from "next/navigation";

// Advisors are kept in one place: Village Square → Circles of advisors
// (the advisory team map). This tab opens it.
export default async function AdvisorsPage({ params }: { params: Promise<{ familyId: string }> }) {
  const { familyId } = await params;
  redirect(`/families/${familyId}/village/advisors`);
}
