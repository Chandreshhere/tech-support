import { getKeys, getAppConfig, listContexts } from '../services/api.js';

// Inspect backend state and decide where the user should land next.
// Returns { route, reason }. The landing-page CTA hits this, then navigates.
//
// Precedence: keys → active-model config → at least one context.
// The first gate that isn't satisfied wins and sends the user to the
// matching step of /onboarding. Everything satisfied → open the project
// (direct to /c/<slug> if there's only one, dashboard if there are many).
export async function resolveNextRoute() {
  const [keysRes, cfgRes, ctxRes] = await Promise.allSettled([
    getKeys(), getAppConfig(), listContexts(),
  ]);

  const keys      = keysRes.status === 'fulfilled' ? (keysRes.value.data.keys || [])     : [];
  const config    = cfgRes.status  === 'fulfilled' ? (cfgRes.value.data || {})           : {};
  const contexts  = ctxRes.status  === 'fulfilled' ? (ctxRes.value.data.contexts || [])  : [];

  // Gate 1: at least one API key on file.
  if (keys.length === 0) {
    return { route: '/onboarding?step=keys', reason: 'no_keys' };
  }

  // Gate 2: activeProvider points at a configured key + model that still exists.
  const provider    = config?.llm?.activeProvider;
  const providerCfg = provider ? config?.llm?.[provider] : null;
  const hasActiveKey = !!providerCfg?.activeKeyId && keys.some(k => k.id === providerCfg.activeKeyId);
  const hasActiveModel = !!providerCfg?.activeModel;
  if (!provider || !hasActiveKey || !hasActiveModel) {
    return { route: '/onboarding?step=model', reason: 'no_model' };
  }

  // Gate 3: at least one project.
  if (contexts.length === 0) {
    return { route: '/onboarding?step=project', reason: 'no_project' };
  }

  // Fully configured.
  if (contexts.length === 1) {
    return { route: `/c/${contexts[0].slug}`, reason: 'single_project' };
  }
  return { route: '/dashboard', reason: 'multi_project' };
}
