export const ENTERPRISE_AGENT_STORAGE_KEY = 'ultrarag_enterprise_agent_scope';
export const SELECTED_AGENT_STORAGE_KEY = ENTERPRISE_AGENT_STORAGE_KEY;
export const SESSION_FILTER_STORAGE_PREFIX = 'skill_agent_session_filter';

export function sessionFilterStorageKey(userId: string): string {
  return `${SESSION_FILTER_STORAGE_PREFIX}:${userId || 'anonymous'}`;
}

export function persistSharedAgentScope(agentId: string, userId?: string): void {
  if (!agentId) return;
  window.localStorage.setItem(ENTERPRISE_AGENT_STORAGE_KEY, agentId);
  if (userId) {
    window.localStorage.setItem(sessionFilterStorageKey(userId), agentId);
  }
}

export function clearSharedAgentScope(userId?: string): void {
  window.localStorage.removeItem(ENTERPRISE_AGENT_STORAGE_KEY);
  if (userId) {
    window.localStorage.removeItem(sessionFilterStorageKey(userId));
  }
}

export function emitAgentScopeChange(agentId: string): void {
  window.dispatchEvent(
    new CustomEvent('ultrarag-enterprise-agent-scope-change', {
      detail: { agentId },
    }),
  );
}
