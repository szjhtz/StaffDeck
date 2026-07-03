import {
  AppstoreOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  ProfileOutlined,
  RightOutlined,
  SolutionOutlined,
  ToolOutlined,
  UsergroupAddOutlined,
} from '../icons';
import { Button, Card, Drawer, Empty, Modal, Tag, Typography, message } from 'antd';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, TENANT_ID } from '../api/client';
import { isEmployeeOwnedBy, isGalleryEmployee, type EnterpriseAuthUser } from '../auth';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { employeeDisplayName, employeeProfile } from '../employee';
import type { AgentProfileRead, GeneralSkillRead, KnowledgeBaseRead, SkillRead, ToolRead } from '../types';

const ENTERPRISE_AGENT_STORAGE_KEY = 'ultrarag_enterprise_agent_scope';

type PlatformKind = 'agents' | 'knowledge' | 'general-skills' | 'skills' | 'tools';

type PlatformConfig = {
  kind: PlatformKind;
  title: string;
  subtitle: string;
  detail: string;
  useLabel: string;
  metricLabel: string;
  signals: string[];
  icon: ReactNode;
};

type PlatformItem = {
  id: string;
  deleteKey?: string;
  title: string;
  description: string;
  meta: string;
  tags: string[];
  agent?: AgentProfileRead;
};

const PLATFORM_CONFIGS: PlatformConfig[] = [
  {
    kind: 'agents',
    title: '数字员工广场',
    subtitle: '已发布到广场，可在对话端直接使用。',
    detail: '选择一个数字员工查看能力、岗位和服务范围。',
    useLabel: '使用此员工',
    metricLabel: '数字员工',
    signals: ['对话端可用', '支持直接对话', '岗位能力可查看'],
    icon: <UsergroupAddOutlined />,
  },
  {
    kind: 'knowledge',
    title: '知识库广场',
    subtitle: '发布到广场的知识库，可复制到你的数字员工。',
    detail: '从广场复制到当前数字员工的知识库。',
    useLabel: '复制到知识库',
    metricLabel: '知识库',
    signals: ['知识图谱', '引用来源', '可复制'],
    icon: <FileSearchOutlined />,
  },
  {
    kind: 'general-skills',
    title: '技能广场',
    subtitle: '浏览器、MCP、查询工具等可复用能力。',
    detail: '从广场复制到当前数字员工的技能。',
    useLabel: '复制到技能',
    metricLabel: '技能',
    signals: ['运行测试', 'MCP / 浏览器', '可复用能力'],
    icon: <SolutionOutlined />,
  },
  {
    kind: 'skills',
    title: 'SOP 广场',
    subtitle: '可复制和复用的业务流程与执行规范。',
    detail: '从广场复制到当前数字员工的 SOP。',
    useLabel: '复制到 SOP',
    metricLabel: '业务 SOP',
    signals: ['流程推进', '执行规范', '可复制'],
    icon: <ProfileOutlined />,
  },
  {
    kind: 'tools',
    title: '工具广场',
    subtitle: '可开放给员工调用和测试的工具能力。',
    detail: '前往工具页按现有流程配置和测试工具。',
    useLabel: '前往工具页',
    metricLabel: '工具能力',
    signals: ['调用权限', '测试可用', '工具配置'],
    icon: <ToolOutlined />,
  },
];

const PLATFORM_BY_KIND = new Map(PLATFORM_CONFIGS.map((item) => [item.kind, item]));

export default function OpenPlatformPage({
  currentUser,
  isAdmin = false,
}: {
  currentUser?: EnterpriseAuthUser;
  isAdmin?: boolean;
}) {
  const navigate = useNavigate();
  const { kind } = useParams<{ kind?: PlatformKind }>();
  const selectedKind = kind && PLATFORM_BY_KIND.has(kind) ? kind : undefined;
  const [agents, setAgents] = useState<AgentProfileRead[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseRead[]>([]);
  const [generalSkills, setGeneralSkills] = useState<GeneralSkillRead[]>([]);
  const [skills, setSkills] = useState<SkillRead[]>([]);
  const [tools, setTools] = useState<ToolRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingItemKey, setDeletingItemKey] = useState('');
  const [agentId, setAgentId] = useState(() => window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY) || '');
  const [detailItem, setDetailItem] = useState<{ kind: PlatformKind; item: PlatformItem } | null>(null);

  useEffect(() => {
    const onScopeChange = (event: Event) => {
      const nextAgentId = (event as CustomEvent<{ agentId?: string }>).detail?.agentId
        || window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY)
        || '';
      setAgentId(nextAgentId);
    };
    window.addEventListener('ultrarag-enterprise-agent-scope-change', onScopeChange);
    return () => window.removeEventListener('ultrarag-enterprise-agent-scope-change', onScopeChange);
  }, []);

  const loadPlatformData = useCallback(async () => {
    setLoading(true);
    try {
      const agentRows = await api.get<AgentProfileRead[]>(`/api/enterprise/agents?tenant_id=${TENANT_ID}`);
      const overall = agentRows.find((item) => item.is_overall);
      const overallSuffix = overall ? `&agent_id=${encodeURIComponent(overall.id)}` : '';
      const [kbRows, generalRows, skillRows, toolRows] = await Promise.all([
        api.get<KnowledgeBaseRead[]>(`/api/enterprise/knowledge-bases?tenant_id=${TENANT_ID}${overallSuffix}`),
        api.get<GeneralSkillRead[]>(`/api/enterprise/general-skills?tenant_id=${TENANT_ID}${overallSuffix}`),
        overall
          ? api.get<SkillRead[]>(`/api/enterprise/agents/${overall.id}/skills?tenant_id=${TENANT_ID}`)
          : Promise.resolve([]),
        api.get<ToolRead[]>(`/api/enterprise/tools?tenant_id=${TENANT_ID}${overallSuffix}`),
      ]);
      setAgents(agentRows);
      setKnowledgeBases(kbRows);
      setGeneralSkills(generalRows);
      setSkills(skillRows);
      setTools(toolRows);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载开放广场失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlatformData();
  }, [loadPlatformData]);

  const visibleAgents = useMemo(
    () => agents.filter((item) => !item.is_overall && item.status === 'active' && isGalleryEmployee(item)),
    [agents],
  );
  const overallAgent = agents.find((item) => item.is_overall) || null;
  const canManagePlatform = isAdmin;
  const currentAgent = agents.find((item) => item.id === agentId);
  const targetEmployee = !currentAgent?.is_overall && currentAgent
    ? currentAgent
    : agents.find((item) => !item.is_overall && (isAdmin || isEmployeeOwnedBy(item, currentUser) || isGalleryEmployee(item)));

  const platformItems = useMemo<Record<PlatformKind, PlatformItem[]>>(() => ({
    agents: visibleAgents.map((item) => {
      const profile = employeeProfile(item);
      return {
        id: item.id,
        deleteKey: item.id,
        title: employeeDisplayName(item),
        description: item.description || '广场开放的数字员工。',
        meta: profile.roleName,
        tags: [
          item.status === 'active' ? '在线' : '下线',
          `SOP ${resourceCount(item, 'skill')}`,
          `技能 ${resourceCount(item, 'general_skill')}`,
        ],
        agent: item,
      };
    }),
    knowledge: knowledgeBases
      .filter((item) => item.status === 'active' && !isEmptyDefaultKnowledgeBase(item))
      .map((item) => ({
        id: item.id,
        deleteKey: item.id,
        title: item.name,
        description: item.description || '广场沉淀的知识库。',
        meta: `${item.document_count} 文档 / ${item.bucket_count} 桶 / ${item.chunk_count} 片段`,
        tags: [item.version || 'v1.0.0', item.branch_sync_state || '广场版'],
      })),
    'general-skills': generalSkills
      .filter((item) => item.status === 'published')
      .map((item) => ({
        id: item.id,
        deleteKey: item.slug,
        title: item.name,
        description: item.description || '可复制到当前数字员工的技能。',
        meta: item.slug,
        tags: [item.homepage ? '外部能力' : '内置能力', '已启用'],
      })),
    skills: skills
      .filter((item) => item.status === 'published')
      .map((item) => ({
        id: item.id,
        deleteKey: item.id,
        title: item.name,
        description: item.description || '可复制和复用的业务 SOP。',
        meta: `${item.skill_id} / ${item.version}`,
        tags: [item.business_domain || '业务流程', `${item.total_call_count || item.call_count || 0} 次调用`],
      })),
    tools: tools
      .filter((item) => item.enabled)
      .map((item) => ({
        id: item.id,
        deleteKey: item.id,
        title: item.display_name || item.name,
        description: item.description || '可配置到员工工具的工具。',
        meta: `${item.bucket || '工具'} / ${item.tool_type.toUpperCase()}`,
        tags: [item.method, item.enabled ? '已启用' : '已停用'],
      })),
  }), [generalSkills, knowledgeBases, skills, tools, visibleAgents]);

  const platformStats = PLATFORM_CONFIGS.map((config) => ({
    ...config,
    count: platformItems[config.kind].length,
  }));

  function ensureTargetEmployee(): boolean {
    if (!targetEmployee) {
      message.warning('请先选择一个员工，再从广场复制资源。');
      return false;
    }
    if (targetEmployee.id !== agentId) {
      window.localStorage.setItem(ENTERPRISE_AGENT_STORAGE_KEY, targetEmployee.id);
      window.dispatchEvent(new CustomEvent('ultrarag-enterprise-agent-scope-change', { detail: { agentId: targetEmployee.id } }));
      setAgentId(targetEmployee.id);
    }
    return true;
  }

  function usePlatformItem(platformKind: PlatformKind, itemId?: string) {
    if (platformKind === 'agents') {
      const agent = visibleAgents.find((item) => item.id === itemId) || visibleAgents[0];
      if (!agent) {
        message.warning('广场暂无可用数字员工');
        return;
      }
      window.localStorage.setItem(ENTERPRISE_AGENT_STORAGE_KEY, agent.id);
      window.dispatchEvent(new CustomEvent('ultrarag-enterprise-agent-scope-change', { detail: { agentId: agent.id } }));
      navigate('/enterprise/dashboard');
      return;
    }
    if (!ensureTargetEmployee()) return;
    const resourceParam = itemId ? `&resourceId=${encodeURIComponent(itemId)}` : '';
    if (platformKind === 'knowledge') navigate(`/enterprise/knowledge?add=plaza${resourceParam}`);
    if (platformKind === 'general-skills') navigate(`/enterprise/general-skills?add=plaza${resourceParam}`);
    if (platformKind === 'skills') navigate(`/enterprise/skills?add=plaza${resourceParam}`);
    if (platformKind === 'tools') navigate('/enterprise/tools?add=plaza');
  }

  function platformItemDeleteKey(platformKind: PlatformKind, item: PlatformItem): string {
    return `${platformKind}:${item.deleteKey || item.id}`;
  }

  function platformDeleteUrl(platformKind: PlatformKind, item: PlatformItem): string {
    const resourceKey = encodeURIComponent(item.deleteKey || item.id);
    const overallSuffix = overallAgent ? `&agent_id=${encodeURIComponent(overallAgent.id)}` : '';
    if (platformKind === 'agents') return `/api/enterprise/agents/${resourceKey}?tenant_id=${TENANT_ID}`;
    if (platformKind === 'knowledge') return `/api/enterprise/knowledge-bases/${resourceKey}?tenant_id=${TENANT_ID}${overallSuffix}`;
    if (platformKind === 'general-skills') return `/api/enterprise/general-skills/${resourceKey}?tenant_id=${TENANT_ID}${overallSuffix}`;
    if (platformKind === 'skills') return `/api/enterprise/skills/${resourceKey}?tenant_id=${TENANT_ID}${overallSuffix}`;
    return `/api/enterprise/tools/${resourceKey}?tenant_id=${TENANT_ID}${overallSuffix}`;
  }

  function deletePlatformItem(platformKind: PlatformKind, item: PlatformItem) {
    const config = PLATFORM_BY_KIND.get(platformKind) || PLATFORM_CONFIGS[0];
    const key = platformItemDeleteKey(platformKind, item);
    Modal.confirm({
      title: `删除${config.metricLabel}「${item.title}」？`,
      content: platformKind === 'agents'
        ? '删除后该数字员工会从广场和员工列表移除，相关资源绑定也会一并清理。'
        : '删除后该广场内容会从开放平台移除，已复制到员工侧的引用可能不再可同步。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setDeletingItemKey(key);
        try {
          await api.delete(platformDeleteUrl(platformKind, item));
          message.success('已删除广场内容');
          setDetailItem((current) => (
            current && current.kind === platformKind && current.item.id === item.id ? null : current
          ));
          await loadPlatformData();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败');
          throw error;
        } finally {
          setDeletingItemKey('');
        }
      },
    });
  }

  function renderItemDrawer() {
    if (!detailItem) return null;
    const config = PLATFORM_BY_KIND.get(detailItem.kind) || PLATFORM_CONFIGS[0];
    const { item } = detailItem;
    const deleteKey = platformItemDeleteKey(detailItem.kind, item);
    return (
      <Drawer
        className="open-platform-item-drawer"
        title={null}
        width={560}
        open
        onClose={() => setDetailItem(null)}
        footer={(
          <div className="open-platform-drawer-footer">
            {canManagePlatform && (
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={deletingItemKey === deleteKey}
                onClick={() => deletePlatformItem(detailItem.kind, item)}
              >
                删除
              </Button>
            )}
            <Button onClick={() => setDetailItem(null)}>关闭</Button>
            <Button
              type="primary"
              onClick={() => {
                setDetailItem(null);
                usePlatformItem(detailItem.kind, item.id);
              }}
            >
              {config.useLabel}
            </Button>
          </div>
        )}
      >
        <div className="open-platform-drawer-hero">
          {item.agent ? <EmployeeAvatar agent={item.agent} size={64} /> : <span className="open-platform-resource-icon">{config.icon}</span>}
          <div>
            <Typography.Text type="secondary">{config.title}</Typography.Text>
            <Typography.Title level={3}>{item.title}</Typography.Title>
            <Typography.Paragraph>{item.description}</Typography.Paragraph>
          </div>
        </div>
        <div className="open-platform-drawer-meta-grid">
          <div>
            <span>来源</span>
            <strong>{config.title}</strong>
          </div>
          <div>
            <span>分类</span>
            <strong>{item.meta}</strong>
          </div>
        </div>
        <div className="open-platform-drawer-tags">
          {item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
        </div>
        <div className="open-platform-drawer-summary">
          <Typography.Text type="secondary">说明</Typography.Text>
          <p>{config.detail}</p>
        </div>
      </Drawer>
    );
  }

  if (selectedKind) {
    const config = PLATFORM_BY_KIND.get(selectedKind) || PLATFORM_CONFIGS[0];
    const items = platformItems[selectedKind];
    return (
      <div className="page open-platform-page">
        <div className="open-platform-detail-hero">
          <div>
            <Typography.Text type="secondary">开放广场 / {config.title}</Typography.Text>
            <Typography.Title level={2}>{config.title}</Typography.Title>
            <Typography.Paragraph type="secondary">{config.detail}</Typography.Paragraph>
          </div>
          <Button onClick={() => navigate('/enterprise/platform')}>返回平台</Button>
        </div>
        <Card className="open-platform-detail-card" loading={loading}>
          {items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无开放内容" />
          ) : (
            <div className="open-platform-resource-grid">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`open-platform-resource-card${item.agent ? ' is-agent' : ''}`}
                  onClick={() => setDetailItem({ kind: selectedKind, item })}
                >
                  {item.agent && <EmployeeAvatar agent={item.agent} size={48} />}
                  {!item.agent && <span className="open-platform-resource-icon">{config.icon}</span>}
                  <span className="open-platform-resource-copy">
                    <strong>{item.title}</strong>
                    <em>{item.meta}</em>
                    <span>{item.description}</span>
                    <span className="open-platform-tags">
                      {item.tags.slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                    </span>
                  </span>
                  <span className="open-platform-use">查看详情 <RightOutlined /></span>
                </button>
              ))}
            </div>
          )}
        </Card>
        {renderItemDrawer()}
      </div>
    );
  }

  return (
    <div className="page open-platform-page open-platform-page-main">
      <div className="page-title open-platform-title">
        <div>
          <Typography.Text type="secondary">开放广场</Typography.Text>
          <Typography.Title level={2}>开放广场</Typography.Title>
          <Typography.Paragraph>
            汇总数字员工、知识库、技能、SOP 和工具五个广场。先进入广场查看详情，再把需要的能力复制到当前数字员工。
          </Typography.Paragraph>
        </div>
        <Tag className="open-platform-target" icon={<AppstoreOutlined />}>
          复制到：{targetEmployee ? employeeDisplayName(targetEmployee) : '未选择'}
        </Tag>
      </div>
      <div className="open-platform-overview-shell">
        <div className="open-platform-grid">
          {platformStats.map((platform) => {
            const previews = platformItems[platform.kind].slice(0, 4);
            return (
              <Card key={platform.kind} className="open-platform-card open-platform-row-card" hoverable loading={loading}>
                <div className="open-platform-card-head">
                  <span className="open-platform-card-icon">{platform.icon}</span>
                  <strong>{platform.count}</strong>
                  <em>{platform.metricLabel}</em>
                </div>
                <div className="open-platform-card-copy">
                  <Typography.Title level={4}>{platform.title}</Typography.Title>
                  <Typography.Paragraph type="secondary">{platform.subtitle}</Typography.Paragraph>
                  <div className="open-platform-signal-strip">
                    {platform.signals.map((signal) => <span key={signal}>{signal}</span>)}
                  </div>
                </div>
                <div className="open-platform-preview-panel">
                  <div className="open-platform-preview-heading">
                    <span>广场内容</span>
                    <em>{previews.length ? `${platform.count} 项可用` : '等待开放'}</em>
                  </div>
                  <div className="open-platform-card-preview-list">
                    {previews.length === 0 ? (
                      <span className="open-platform-preview-empty">暂无开放内容</span>
                    ) : previews.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`open-platform-preview-item${item.agent ? ' is-agent-preview' : ''}`}
                        onClick={() => setDetailItem({ kind: platform.kind, item })}
                      >
                        <span className="open-platform-preview-media">
                          {item.agent ? <EmployeeAvatar agent={item.agent} size={42} /> : <span>{platform.icon}</span>}
                        </span>
                        <span className="open-platform-preview-copy">
                          <strong>{item.title}</strong>
                          <span>{item.meta}</span>
                          <small>{item.description}</small>
                          <span className="open-platform-preview-tags">
                            {item.tags.slice(0, 2).map((tag) => <em key={tag}>{tag}</em>)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="open-platform-card-actions">
                  <span>{platform.detail}</span>
                  <Button onClick={() => navigate(`/enterprise/platform/${platform.kind}`)}>
                    查看详情 <RightOutlined />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
      {renderItemDrawer()}
    </div>
  );
}

function resourceCount(agent: AgentProfileRead, resourceType: string): number {
  return (agent.resources || []).filter((item) => item.resource_type === resourceType && item.status !== 'inactive').length;
}

function isEmptyDefaultKnowledgeBase(item: KnowledgeBaseRead): boolean {
  return item.name === '默认知识库' && item.document_count === 0 && item.bucket_count === 0 && item.chunk_count === 0;
}
