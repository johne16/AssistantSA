import { createContext, useContext, type ReactNode } from "react";
import type { resident_session } from "./types";

// Holds the established resident session and passes it to the consuming
// modules (civic, accounts, assistant, notifications). The value is the encoded
// tenant_context_token, never bare claims.

const session_context = createContext<resident_session | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: resident_session;
  children: ReactNode;
}) {
  return (
    <session_context.Provider value={session}>
      {children}
    </session_context.Provider>
  );
}

export function useResidentSession(): resident_session {
  const value = useContext(session_context);
  if (!value) {
    throw new Error("useResidentSession must be used within SessionProvider");
  }
  return value;
}
