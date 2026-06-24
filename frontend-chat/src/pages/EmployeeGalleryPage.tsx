import {
  GlobalOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Button, Empty, Select, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clearAuthSession, getAuthSession, isAuthError } from '../api/client';
import EmployeeAvatarMark from '../components/EmployeeAvatarMark';
import {
  agentResourceCount,
  employeeDisplayName,
  employeeProfile,
  isEmployeeOwnedBy,
  isGalleryEmployee,
  visibleChatEmployees,
} from '../employee';
import { ThemeToggleButton } from '../theme';
import type { AgentProfileRead, ChatSession } from '../types';

function SessionChatIcon() {
  return (
    <svg className="session-chat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 4.2c-4.7 0-8.1 3.05-8.1 7.25 0 2.32 1.02 4.32 2.75 5.65l-.55 2.65 3.05-1.45c.9.26 1.9.4 2.95.4 4.7 0 8.1-3.05 8.1-7.25S16.7 4.2 12 4.2Z" />
      <path d="M8.7 11.45h.04M12 11.45h.04M15.3 11.45h.04" />
    </svg>
  );
}

export default function EmployeeGalleryPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [agents, setAgents] = useState<AgentProfileRead[]>([]);
  const [sessionAgentFilter, setSessionAgentFilter] = useState('all');
  const [selectedAgentId, setSelectedAgentId] = useState(() => window.localStorage.getItem('skill_agent_selected_agent') || '');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => (
    window.localStorage.getItem('skill_agent_sidebar_collapsed') === 'true'
  ));
  const [auth] = useState(() => getAuthSession());
  const navigate = useNavigate();
  const tenantId = auth?.user.tenant_id || 'tenant_demo';
  const availableAgents = visibleChatEmployees(agents, auth?.user);
  const personalAgents = availableAgents.filter((agent) => !isGalleryEmployee(agent) || isEmployeeOwnedBy(agent, auth?.user));
  const personalAgentIds = new Set(personalAgents.map((agent) => agent.id));
  const galleryAgents = availableAgents.filter((agent) => isGalleryEmployee(agent) && !personalAgentIds.has(agent.id));
  const agentById = useMemo(() => new Map(availableAgents.map((agent) => [agent.id, agent])), [availableAgents]);
  const visibleSessions = useMemo(() => (
    sessionAgentFilter === 'all'
      ? sessions
      : sessions.filter((session) => session.agent_id === sessionAgentFilter)
  ), [sessionAgentFilter, sessions]);
  const sessionFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    sessions.forEach((session) => {
      if (!session.agent_id || !agentById.has(session.agent_id)) return;
      counts.set(session.agent_id, (counts.get(session.agent_id) || 0) + 1);
    });
    const rows = Array.from(counts.keys())
      .map((agentId) => agentById.get(agentId))
      .filter((agent): agent is AgentProfileRead => Boolean(agent))
      .sort((a, b) => employeeDisplayName(a).localeCompare(employeeDisplayName(b), 'zh-Hans-CN'));
    return [
      { value: 'all', label: `全部员工 · ${sessions.length}` },
      ...rows.map((agent) => ({
        value: agent.id,
        label: `${employeeDisplayName(agent)} · ${counts.get(agent.id) || 0}`,
      })),
    ];
  }, [agentById, sessions]);

  const loadSessions = () =>
    api
      .get<ChatSession[]>(`/api/chat/sessions?tenant_id=${tenantId}`)
      .then(setSessions)
      .catch((error) => {
        if (isAuthError(error)) {
          clearAuthSession();
          navigate('/login', { replace: true });
          return;
        }
        message.error(error.message);
      });

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    api
      .get<AgentProfileRead[]>(`/api/chat/agents?tenant_id=${tenantId}`)
      .then((rows) => {
        const employeeRows = visibleChatEmployees(rows, auth?.user);
        setAgents(employeeRows);
        setSelectedAgentId((current) => {
          if (current && employeeRows.some((item) => item.id === current)) return current;
          const next = employeeRows[0]?.id || '';
          if (next) window.localStorage.setItem('skill_agent_selected_agent', next);
          return next;
        });
      })
      .catch(() => setAgents([]));
  }, [auth?.user, tenantId]);

  useEffect(() => {
    if (sessionAgentFilter === 'all') return;
    if (!sessionFilterOptions.some((item) => item.value === sessionAgentFilter)) {
      setSessionAgentFilter('all');
    }
  }, [sessionAgentFilter, sessionFilterOptions]);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('skill_agent_sidebar_collapsed', String(next));
      return next;
    });
  }

  async function createSessionForAgent(agentId: string) {
    if (!agentId) {
      message.warning('请先选择接单员工');
      return;
    }
    const session = await api.post<ChatSession>('/api/chat/sessions', { tenant_id: tenantId, agent_id: agentId });
    setSelectedAgentId(agentId);
    window.localStorage.setItem('skill_agent_selected_agent', agentId);
    navigate(`/${session.id}`);
  }

  const renderEmployeeCards = (rows: AgentProfileRead[], emptyText: string) => {
    if (!rows.length) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
    }
    return rows.map((agent) => {
      const profile = employeeProfile(agent);
      const sopCount = agentResourceCount(agent, 'skill');
      const skillCount = agentResourceCount(agent, 'general_skill');
      const knowledgeCount = agentResourceCount(agent, 'knowledge_base');
      const updatedAt = agent.updated_at ? new Date(agent.updated_at) : null;
      const updatedLabel = updatedAt && !Number.isNaN(updatedAt.getTime())
        ? `${updatedAt.getMonth() + 1}/${updatedAt.getDate()} 更新`
        : '可派发';
      return (
        <button
          key={agent.id}
          type="button"
          className={`employee-gallery-page-card ${selectedAgentId === agent.id ? 'selected' : ''}`}
          onClick={() => void createSessionForAgent(agent.id)}
        >
          <EmployeeAvatarMark profile={profile} className="employee-gallery-page-avatar" />
          <span className="employee-gallery-page-copy">
            <span className="employee-gallery-page-card-head">
              <span>
                <span className="employee-gallery-page-name">{employeeDisplayName(agent)}</span>
                <span className="employee-gallery-page-role">{profile.roleName}</span>
              </span>
              <span className="employee-gallery-page-action">
                发起对话
                <RightOutlined />
              </span>
            </span>
            <span className="employee-gallery-page-desc">{agent.description || '可直接派发任务，使用该员工的技能、SOP 和业务资料。'}</span>
            <span className="employee-gallery-page-stats">
              <span><strong>{sopCount}</strong><em>SOP</em></span>
              <span><strong>{skillCount}</strong><em>技能</em></span>
              <span><strong>{knowledgeCount}</strong><em>资料</em></span>
            </span>
            <span className="employee-gallery-page-tags">
              <span>在线</span>
              <span>{isGalleryEmployee(agent) ? '员工广场' : '个人员工'}</span>
              <span>{updatedLabel}</span>
            </span>
          </span>
        </button>
      );
    });
  };

  return (
    <div className={`chat-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="session-pane">
        <div className="sidebar-head">
          <Button
            className="icon-button"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            aria-label={sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'}
            onClick={toggleSidebar}
          />
          <div className="brand-block">
            <span className="brand-mark">UR</span>
            <div>
              <div className="brand-title">UltraRAG4</div>
              <div className="brand-subtitle">{auth?.user.display_name || auth?.user.username}</div>
            </div>
          </div>
          <div className="sidebar-actions">
            <Button
              className="icon-button sidebar-logout"
              icon={<LogoutOutlined />}
              onClick={() => {
                clearAuthSession();
                navigate('/login', { replace: true });
              }}
            />
          </div>
        </div>
        {!sidebarCollapsed && (
          <button type="button" className="sidebar-gallery-entry active" onClick={() => navigate('/employees')}>
            <span className="sidebar-gallery-entry-icon"><GlobalOutlined /></span>
            <span className="sidebar-gallery-entry-copy">
              <strong>员工广场</strong>
              <span>个人员工与开放员工</span>
            </span>
            <RightOutlined />
          </button>
        )}
        <div className="session-list-scroll">
          {!sidebarCollapsed && (
            <div className="session-filter-bar">
              <span className="session-filter-label">员工会话</span>
              <Select
                size="small"
                className="session-filter-select"
                value={sessionAgentFilter}
                options={sessionFilterOptions}
                onChange={setSessionAgentFilter}
              />
            </div>
          )}
          <div className="session-section-label">任务记录</div>
          {visibleSessions.length === 0 ? (
            <div className="session-list-empty">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前员工暂无任务记录" />
            </div>
          ) : (
            visibleSessions.map((session) => {
              const sessionTitle = session.title || session.id;
              const sessionSummary = session.summary || session.last_agent_question || '新任务';
              const sessionAgent = session.agent_id ? agentById.get(session.agent_id) || null : null;
              const sessionProfile = sessionAgent ? employeeProfile(sessionAgent) : null;
              const sessionAgentFallback = sessionAgent ? employeeDisplayName(sessionAgent).slice(0, 1) : '员';
              return (
                <div
                  key={session.id}
                  role="button"
                  tabIndex={0}
                  className="session-card"
                  onClick={() => navigate(`/${session.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/${session.id}`);
                    }
                  }}
                >
                  <div className="session-card-content">
                    <span className="session-title-icon session-title-avatar">
                      {sessionProfile ? (
                        <EmployeeAvatarMark
                          profile={sessionProfile}
                          fallback={sessionAgentFallback || '员'}
                          className="session-agent-avatar"
                        />
                      ) : (
                        <SessionChatIcon />
                      )}
                    </span>
                    <div className="session-meta">
                      <div className="session-title" title={sessionTitle}>
                        <span className="session-title-text">{sessionTitle}</span>
                      </div>
                      <div className="session-summary" title={sessionSummary}>
                        {sessionSummary}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
      <main className="chat-main employee-gallery-page-main">
        <div className="chat-header">
          <div>
            <Typography.Text strong>员工广场</Typography.Text>
            <div className="header-subtitle">选择个人员工或开放员工，直接发起任务对话</div>
          </div>
          <div className="chat-header-actions">
            <ThemeToggleButton />
          </div>
        </div>
        <div className="employee-gallery-page">
          <section className="employee-gallery-page-hero">
            <span className="employee-gallery-page-hero-icon"><GlobalOutlined /></span>
            <div>
              <Typography.Title level={2}>选择接单员工</Typography.Title>
              <Typography.Paragraph>
                员工广场是任务派发入口。个人员工来自当前账号，开放员工来自员工广场，点击卡片即可创建新会话。
              </Typography.Paragraph>
            </div>
          </section>

          <section className="employee-gallery-page-section">
            <div className="employee-gallery-page-section-head">
              <div>
                <Typography.Title level={3}>个人员工</Typography.Title>
                <Typography.Text type="secondary">当前账号可直接派发的员工。</Typography.Text>
              </div>
              <span>{personalAgents.length}</span>
            </div>
            <div className="employee-gallery-page-grid">
              {renderEmployeeCards(personalAgents, '暂无个人员工')}
            </div>
          </section>

          <section className="employee-gallery-page-section">
            <div className="employee-gallery-page-section-head">
              <div>
                <Typography.Title level={3}>员工广场</Typography.Title>
                <Typography.Text type="secondary">已开放给任务派发台选择的数字员工。</Typography.Text>
              </div>
              <span>{galleryAgents.length}</span>
            </div>
            <div className="employee-gallery-page-grid">
              {renderEmployeeCards(galleryAgents, '员工广场暂无开放员工')}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
