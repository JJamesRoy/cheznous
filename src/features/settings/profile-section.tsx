"use client";

import imageCompression from "browser-image-compression";
import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar, Button, Field, Input } from "@/components/ui";
import { useMembers, useSession } from "@/features/app/session";
import { useOpMutation } from "@/lib/data/query";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { haptic } from "@/lib/ui/haptics";
import { toneForMember } from "@/lib/ui/people";
import { AVATAR_BUCKET, useAvatarUrl } from "./avatar-url";
import { InlineError, Panel, SettingsSection } from "./section";

export function ProfileSection() {
  const session = useSession();
  const { me, members } = useMembers();
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? me.displayName;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarUrl = useAvatarUrl(me.avatarPath);
  const tone = toneForMember(
    members.map((m) => m.userId),
    me.userId,
  );

  const update = useOpMutation("profile.update", {
    onSuccess: () => {
      setDraft(null);
      haptic("success");
    },
  });

  async function onFile(file: File) {
    setUploadError(null);
    if (!file.type.startsWith("image/")) return setUploadError("Choisis une image (JPEG, PNG, HEIC…).");
    setUploading(true);
    try {
      const compressed = await imageCompression(file, {
        maxWidthOrHeight: 512,
        maxSizeMB: 0.25,
        fileType: "image/webp",
        initialQuality: 0.85,
        useWebWorker: true,
      });
      const path = `avatars/${session.user.id}/${crypto.randomUUID()}.webp`;
      const { error } = await getBrowserSupabase().storage.from(AVATAR_BUCKET).upload(path, compressed, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw error;
      await update.mutateAsync({ displayName: me.displayName, avatarPath: path });
    } catch (e) {
      setUploadError(
        (e as Error).name === "ApiError" ? (e as Error).message : "Impossible d'envoyer la photo. Vérifie ta connexion et réessaie.",
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const dirty = draft !== null && draft.trim() !== me.displayName;

  return (
    <SettingsSection id="profil" title="Profil" description="Ce que ton ou ta partenaire voit de toi.">
      <Panel>
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar name={me.displayName} src={avatarUrl} tone={tone.key} size="lg" className="size-14 text-base" decorative />
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                <Camera aria-hidden />
                {me.avatarPath ? "Changer la photo" : "Ajouter une photo"}
              </Button>
              {me.avatarPath ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={uploading || update.isPending}
                  onClick={() => update.mutate({ displayName: me.displayName, avatarPath: null })}
                >
                  Retirer
                </Button>
              ) : null}
            </div>
          </div>
          {uploadError ? <InlineError>{uploadError}</InlineError> : null}
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return setUploadError("Ton prénom est requis.");
              setUploadError(null);
              if (dirty) update.mutate({ displayName: name.trim() });
            }}
          >
            <Field label="Prénom" className="flex-1" error={update.error && !uploading ? update.error.message : undefined}>
              <Input value={name} onChange={(e) => setDraft(e.target.value)} maxLength={60} autoComplete="given-name" />
            </Field>
            {dirty || (update.isPending && !uploading) ? (
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)} className="flex-1 sm:flex-none">
                  Annuler
                </Button>
                <Button type="submit" variant="primary" loading={update.isPending && !uploading} className="flex-1 sm:flex-none">
                  Enregistrer
                </Button>
              </div>
            ) : null}
          </form>
        </div>
      </Panel>
    </SettingsSection>
  );
}
