import { NoteEditorScreen } from "@/features/notes/note-editor";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NoteEditorScreen id={id} />;
}
