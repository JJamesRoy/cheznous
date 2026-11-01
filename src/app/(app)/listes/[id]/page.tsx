import { ListsScreen } from "@/features/lists/lists-screen";

export default async function ListePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListsScreen listId={id} />;
}
