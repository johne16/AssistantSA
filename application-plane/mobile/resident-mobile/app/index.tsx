import { Shell } from '@/m-res-shell/Shell';

// The app's entry route. This proof of concept has no login: it mounts the
// resident shell, which resolves the stub default-user tenant_context_token,
// builds the single default-user residentSession, and renders the portal
// directly. There is no auth or guest slot to inject.
export default function Index() {
  return <Shell />;
}
