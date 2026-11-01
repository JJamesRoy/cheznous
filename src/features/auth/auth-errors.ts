import type { AuthError } from "@supabase/supabase-js";

/** Supabase Auth error → short Québec French message. */
export function authErrorMessage(error: AuthError | Error | null | undefined): string {
  if (!error) return "";
  const code = "code" in error ? (error as AuthError).code : undefined;
  const status = "status" in error ? (error as AuthError).status : undefined;
  switch (code) {
    case "invalid_credentials":
      return "Courriel ou mot de passe invalide.";
    case "email_not_confirmed":
      return "Confirme d'abord ton courriel : on t'a envoyé un lien.";
    case "user_already_exists":
    case "email_exists":
      return "Un compte existe déjà avec ce courriel. Connecte-toi plutôt.";
    case "weak_password":
      return "Ce mot de passe est trop faible. Choisis-en un plus long ou moins courant.";
    case "same_password":
      return "Choisis un mot de passe différent de l'ancien.";
    case "email_address_invalid":
    case "validation_failed":
      return "Ce courriel ne semble pas valide.";
    case "otp_disabled":
    case "user_not_found":
      return "Aucun compte avec ce courriel. Crée plutôt un compte.";
    case "signup_disabled":
      return "Les inscriptions sont fermées sur ce serveur.";
    case "over_email_send_rate_limit":
      return "Trop de courriels envoyés. Réessaie dans quelques minutes.";
    case "over_request_rate_limit":
      return "Trop de tentatives. Réessaie dans une minute.";
    case "session_not_found":
    case "refresh_token_not_found":
      return "Ta session a expiré. Reconnecte-toi.";
  }
  if (error.name === "AuthRetryableFetchError" || status === 0 || (error instanceof TypeError && /fetch/i.test(error.message))) {
    return "Impossible de joindre le serveur. Vérifie ta connexion.";
  }
  if (status === 429) return "Trop de tentatives. Réessaie dans une minute.";
  return "Une erreur est survenue. Réessaie.";
}
