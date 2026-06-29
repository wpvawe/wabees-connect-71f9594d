import { FirebaseError } from "firebase/app";

/** Translate Firebase Auth error codes into short user-friendly messages. */
export function friendlyAuthError(err: unknown, fallback: string): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case "auth/invalid-email":
        return "That email doesn't look right";
      case "auth/user-disabled":
        return "This account is disabled — contact support";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Invalid email or password";
      case "auth/email-already-in-use":
        return "An account with that email already exists";
      case "auth/weak-password":
        return "Password is too weak — use 6+ characters";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "Sign-in cancelled";
      case "auth/popup-blocked":
        return "Your browser blocked the sign-in popup";
      case "auth/unauthorized-domain":
        return "This domain isn't authorized in Firebase Console";
      case "auth/network-request-failed":
        return "Network error — check your connection";
      case "auth/too-many-requests":
        return "Too many attempts — try again later";
      case "auth/expired-action-code":
      case "auth/invalid-action-code":
        return "Reset link expired — request a new one";
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
