import {
  ApiOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  DownOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  SyncOutlined,
  TeamOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { AutoComplete, Button, Card, Checkbox, Dropdown, Empty, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { FormInstance } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, TENANT_ID } from '../api/client';
import CodeBlock from '../components/CodeBlock';
import type {
  AgentProfileRead,
  MCPDiscoverResponse,
  MCPServerConnection,
  MCPServerRead,
  MCPSyncResponse,
  MCPTransport,
  ToolRead,
} from '../types';

const ENTERPRISE_AGENT_STORAGE_KEY = 'ultrarag_enterprise_agent_scope';
const TOOL_FORM_INITIAL_VALUES = {
  tool_type: 'http',
  method: 'POST',
  enabled: true,
  bucket: '未分桶',
  headers: '{}',
  auth: '{}',
  mcp_config: '{}',
  input_schema: '{}',
  output_schema: '{}',
};

const TRANSPORT_OPTIONS: { value: MCPTransport; label: string; hint: string }[] = [
  { value: 'streamable_http', label: 'Streamable HTTP', hint: '通过 HTTP(S) 连接远程 MCP Server' },
  { value: 'sse', label: 'SSE', hint: '通过 Server-Sent Events 连接远程 MCP Server' },
  { value: 'stdio', label: 'Stdio（本地命令）', hint: '启动本地进程并通过标准输入输出通信' },
  { value: 'builtin', label: '内置 Demo', hint: '使用内置的 builtin.demo MCP，仅用于演示' },
];

const DEFAULT_MCP_CONNECTION: MCPServerConnection = {
  transport: 'streamable_http',
  url: '',
  headers: {},
  command: '',
  args: [],
  env: {},
  cwd: '',
};

type ToolFormValues = typeof TOOL_FORM_INITIAL_VALUES & {
  name?: string;
  display_name?: string;
  description?: string;
  allowed_skills?: string;
  url?: string;
};

type ToolTreeRow = {
  key: string;
  kind: 'server' | 'tool';
  server?: MCPServerRead;
  tool?: ToolRead;
  children?: ToolTreeRow[];
};

export default function ToolsPage() {
  const [rows, setRows] = useState<ToolRead[]>([]);
  const [servers, setServers] = useState<MCPServerRead[]>([]);
  const [agentId, setAgentId] = useState(() => window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY) || '');
  const [isOverallAgent, setIsOverallAgent] = useState(true);
  const [agentScopeLoaded, setAgentScopeLoaded] = useState(false);
  const [bucketFilter, setBucketFilter] = useState('__all__');
  const [searchText, setSearchText] = useState('');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const load = () =>
    Promise.all([
      api.get<ToolRead[]>(`/api/enterprise/tools?tenant_id=${TENANT_ID}`),
      api.get<MCPServerRead[]>(`/api/enterprise/mcp-servers?tenant_id=${TENANT_ID}`).catch(() => [] as MCPServerRead[]),
    ])
      .then(([toolRows, serverRows]) => {
        setRows(toolRows);
        setServers(serverRows);
      })
      .catch((error) => message.error(error.message));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const loadAgentScope = async () => {
      try {
        const agents = await api.get<AgentProfileRead[]>(`/api/enterprise/agents?tenant_id=${TENANT_ID}`);
        const selectedAgent = agents.find((agent) => agent.id === agentId) || agents.find((agent) => agent.is_overall) || null;
        setIsOverallAgent(Boolean(selectedAgent?.is_overall));
        setAgentScopeLoaded(true);
      } catch {
        setIsOverallAgent(true);
        setAgentScopeLoaded(true);
      }
    };
    void loadAgentScope();
  }, [agentId]);

  useEffect(() => {
    const onScopeChange = (event: Event) => {
      const nextAgentId = (event as CustomEvent<{ agentId?: string }>).detail?.agentId || window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY) || '';
      setAgentId(nextAgentId);
    };
    window.addEventListener('ultrarag-enterprise-agent-scope-change', onScopeChange);
    return () => window.removeEventListener('ultrarag-enterprise-agent-scope-change', onScopeChange);
  }, []);

  useEffect(() => {
    if (searchParams.get('add') !== 'plaza') return;
    if (!agentScopeLoaded) return;
    if (isOverallAgent) {
      message.warning('请先切换到具体数字员工，再从工具广场新增工具');
    } else {
      handleCreateAction('plaza');
    }
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    setSearchParams(next, { replace: true });
  }, [agentScopeLoaded, isOverallAgent, searchParams, setSearchParams]);

  async function remove(row: ToolRead) {
    Modal.confirm({
      title: '删除工具？',
      content: `确认删除「${row.display_name || row.name}」？删除后，引用该工具的技能将无法继续调用它。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const agentQuery = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
        await api.delete(`/api/enterprise/tools/${row.id}?tenant_id=${TENANT_ID}${agentQuery}`);
        message.success('已删除');
        load();
      },
    });
  }

  async function removeServer(server: MCPServerRead) {
    Modal.confirm({
      title: '删除 MCP 服务器？',
      content: `确认删除工具集「${server.display_name || server.name}」？其下 ${server.tool_count} 个已导入工具将一并删除。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const agentQuery = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
        await api.delete(`/api/enterprise/mcp-servers/${server.id}?tenant_id=${TENANT_ID}${agentQuery}&remove_tools=true`);
        message.success('已删除');
        load();
      },
    });
  }

  const visibleRows = useMemo(() => (isOverallAgent ? rows : rows.filter((row) => row.enabled)), [isOverallAgent, rows]);
  const bucketStats = useMemo(() => buildBucketStats(visibleRows), [visibleRows]);

  const filteredFlat = useMemo(() => {
    const text = searchText.trim().toLowerCase();
    return visibleRows.filter((row) => {
      const bucketMatch = bucketFilter === '__all__' || (row.bucket || '未分桶') === bucketFilter;
      if (!bucketMatch) return false;
      if (!text) return true;
      return [row.name, row.display_name || '', row.description || '', row.bucket || '', row.url].some((value) =>
        value.toLowerCase().includes(text),
      );
    });
  }, [bucketFilter, searchText, visibleRows]);

  const treeData = useMemo<ToolTreeRow[]>(() => {
    const serverById = new Map(servers.map((server) => [server.id, server]));
    const childrenByServer = new Map<string, ToolTreeRow[]>();
    const flatTools: ToolTreeRow[] = [];
    filteredFlat.forEach((tool) => {
      if (tool.mcp_server_id && serverById.has(tool.mcp_server_id)) {
        const list = childrenByServer.get(tool.mcp_server_id) || [];
        list.push({ key: `tool:${tool.id}`, kind: 'tool', tool });
        childrenByServer.set(tool.mcp_server_id, list);
        return;
      }
      flatTools.push({ key: `tool:${tool.id}`, kind: 'tool', tool });
    });

    const text = searchText.trim().toLowerCase();
    const serverRows: ToolTreeRow[] = servers
      .filter((server) => bucketFilter === '__all__' || (server.bucket || 'MCP 工具') === bucketFilter)
      .filter((server) => {
        if (!text) return true;
        const children = childrenByServer.get(server.id) || [];
        return (
          [server.name, server.display_name || '', server.description || ''].some((value) => value.toLowerCase().includes(text)) ||
          children.length > 0
        );
      })
      .map((server) => ({
        key: `server:${server.id}`,
        kind: 'server' as const,
        server,
        children: childrenByServer.get(server.id) || [],
      }));

    return [...serverRows, ...flatTools];
  }, [servers, filteredFlat, bucketFilter, searchText]);

  const totalVisible = filteredFlat.length + servers.length;

  const columns: ColumnsType<ToolTreeRow> = [
    {
      title: '名称 / 工具集',
      key: 'name',
      width: 260,
      render: (_, record) => {
        if (record.kind === 'server' && record.server) {
          return (
            <Space>
              <ApiOutlined style={{ color: '#2f54eb' }} />
              <strong>{record.server.display_name || record.server.name}</strong>
              <Tag color="purple">工具集</Tag>
            </Space>
          );
        }
        return <span>{record.tool?.name}</span>;
      },
    },
    {
      title: '展示名称',
      key: 'display_name',
      width: 180,
      ellipsis: true,
      render: (_, record) =>
        record.kind === 'server' ? record.server?.description || '—' : record.tool?.display_name || '—',
    },
    {
      title: '分桶',
      key: 'bucket',
      width: 120,
      render: (_, record) => (
        <Tag className="tool-bucket-tag">
          {(record.kind === 'server' ? record.server?.bucket : record.tool?.bucket) || '未分桶'}
        </Tag>
      ),
    },
    {
      title: '类型 / 连接',
      key: 'type',
      width: 150,
      render: (_, record) => {
        if (record.kind === 'server' && record.server) {
          return <Tag color="geekblue">{transportLabel(record.server.connection.transport)}</Tag>;
        }
        return <Tag color={record.tool?.tool_type === 'mcp' ? 'geekblue' : undefined}>{record.tool?.tool_type === 'mcp' ? 'MCP' : 'HTTP'}</Tag>;
      },
    },
    {
      title: '端点 / URL',
      key: 'url',
      width: 260,
      ellipsis: true,
      render: (_, record) => {
        if (record.kind === 'server' && record.server) {
          const conn = record.server.connection;
          return conn.transport === 'stdio' ? conn.command || '—' : conn.url || (conn.transport === 'builtin' ? 'builtin.demo' : '—');
        }
        return record.tool?.url;
      },
    },
    {
      title: '启用 / 工具数',
      key: 'enabled',
      width: 110,
      render: (_, record) => {
        if (record.kind === 'server' && record.server) {
          return <span>{record.server.tool_count} 个工具</span>;
        }
        return record.tool?.enabled ? '是' : '否';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 300,
      render: (_, record) => {
        if (record.kind === 'server' && record.server) {
          const server = record.server;
          return (
            <span className="table-actions">
              <Button size="small" icon={<SyncOutlined />} onClick={() => navigate(`/enterprise/tools/mcp/${server.id}/edit`)}>
                发现 / 同步
              </Button>
              {isOverallAgent && (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void removeServer(server)}>
                  删除
                </Button>
              )}
            </span>
          );
        }
        const tool = record.tool!;
        const isMcpChild = tool.tool_type === 'mcp' && Boolean(tool.mcp_server_id);
        return (
          <span className="table-actions">
            {!isMcpChild && (
              <Button size="small" onClick={() => navigate(`/enterprise/tools/${tool.id}/edit`)}>
                编辑
              </Button>
            )}
            <Button size="small" icon={<ExperimentOutlined />} onClick={() => navigate(`/enterprise/tools/${tool.id}/test`)}>
              测试
            </Button>
            {isOverallAgent && !isMcpChild && (
              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void remove(tool)}>
                删除
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  function handleCreateAction(key: string) {
    if (key === 'blank') {
      navigate('/enterprise/tools/new');
      return;
    }
    if (key === 'mcp') {
      navigate('/enterprise/tools/mcp/new');
      return;
    }
    if (key === 'plaza') {
      message.info('工具广场能力当前已在工具列表中统一管理，请先新建空白工具并在测试子页面验证。');
      return;
    }
    if (key === 'employee') {
      message.info('员工级工具学习会随工具权限分支能力接入；当前请在工具广场统一维护可用工具。');
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={3}>{isOverallAgent ? '工具广场' : '工具箱'}</Typography.Title>
          <Typography.Text type="secondary">
            {isOverallAgent
              ? '管理可开放给员工调用的工具能力，包括 HTTP 工具与 MCP 工具集。'
              : '查看当前员工可调用的工具能力。'}
          </Typography.Text>
        </div>
      </div>
      <Card
        className="data-card tools-list-card"
        title={isOverallAgent ? '工具广场列表' : '员工工具箱'}
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'blank', icon: <PlusOutlined />, label: '新建 HTTP 工具' },
                  { key: 'mcp', icon: <ApiOutlined />, label: '添加 MCP 服务器（工具集）' },
                  ...(!isOverallAgent ? [{ key: 'plaza', icon: <ToolOutlined />, label: '从工具广场新增' }] : []),
                  ...(!isOverallAgent ? [{ key: 'employee', icon: <TeamOutlined />, label: '向其他员工学习工具' }] : []),
                ],
                onClick: ({ key }) => handleCreateAction(key),
              }}
            >
              <Button type="primary" className="create-dropdown-button">
                新增 <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        )}
      >
        <div className="tool-bucket-strip">
          <button
            className={`tool-bucket-card ${bucketFilter === '__all__' ? 'active' : ''}`}
            type="button"
            onClick={() => setBucketFilter('__all__')}
          >
            <span className="tool-bucket-name">全部工具</span>
            <strong>{visibleRows.length}</strong>
            <span>{visibleRows.filter((row) => row.enabled).length} 个启用</span>
          </button>
          {bucketStats.map((item) => (
            <button
              className={`tool-bucket-card ${bucketFilter === item.bucket ? 'active' : ''}`}
              key={item.bucket}
              type="button"
              onClick={() => setBucketFilter(item.bucket)}
            >
              <span className="tool-bucket-name">{item.bucket}</span>
              <strong>{item.total}</strong>
              <span>{item.enabled} 个启用 · {item.disabled} 个停用</span>
            </button>
          ))}
        </div>
        <div className="tool-filter-bar">
          <Input.Search
            allowClear
            placeholder="搜索工具、工具集名称、描述或 URL"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Typography.Text type="secondary">当前显示 {treeData.length} 项（共 {totalVisible} 项）</Typography.Text>
        </div>
        <Table
          rowKey="key"
          columns={columns}
          dataSource={treeData}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1180 }}
          size="middle"
          expandable={{ defaultExpandAllRows: false }}
        />
      </Card>
    </>
  );
}

export function ToolNewPage() {
  return <ToolEditorPage mode="new" />;
}

export function ToolEditPage() {
  return <ToolEditorPage mode="edit" />;
}

function ToolEditorPage({ mode }: { mode: 'new' | 'edit' }) {
  const [form] = Form.useForm<ToolFormValues>();
  const [tool, setTool] = useState<ToolRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [bucketOptions, setBucketOptions] = useState<{ value: string; label: string }[]>([{ value: '未分桶', label: '未分桶' }]);
  const navigate = useNavigate();
  const { toolId } = useParams();
  const isEdit = mode === 'edit';

  useEffect(() => {
    void loadBucketOptions().then(setBucketOptions);
  }, []);

  useEffect(() => {
    if (!isEdit) {
      form.setFieldsValue(TOOL_FORM_INITIAL_VALUES);
      setTool(null);
      return;
    }
    if (!toolId) return;
    setLoading(true);
    api
      .get<ToolRead>(`/api/enterprise/tools/${toolId}?tenant_id=${TENANT_ID}`)
      .then((row) => {
        setTool(row);
        form.setFieldsValue(toolToFormValues(row));
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载工具失败'))
      .finally(() => setLoading(false));
  }, [form, isEdit, toolId]);

  async function save() {
    let values: ToolFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload = buildToolPayload(values);
    if (!payload) return;
    setLoading(true);
    try {
      const saved = isEdit && toolId
        ? await api.put<ToolRead>(`/api/enterprise/tools/${toolId}`, payload)
        : await api.post<ToolRead>('/api/enterprise/tools', payload);
      message.success('已保存');
      setTool(saved);
      form.setFieldsValue(toolToFormValues(saved));
      if (!isEdit) {
        navigate(`/enterprise/tools/${saved.id}/edit`, { replace: true });
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={3}>{isEdit ? '编辑工具' : '新建空白工具'}</Typography.Title>
          <Typography.Text type="secondary">
            {isEdit ? '修改工具定义，并在右侧验证当前配置或已保存版本。' : '填写工具定义后，可先用右侧探测区测试请求与返回结构。'}
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/enterprise/tools')}>返回工具箱</Button>
          {isEdit && tool && (
            <Button icon={<ExperimentOutlined />} onClick={() => navigate(`/enterprise/tools/${tool.id}/test`)}>
              打开测试页
            </Button>
          )}
          <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={() => void save()}>保存</Button>
        </Space>
      </div>
      <div className="grid-2">
        <Card className="editor-card" title="工具定义" loading={loading && isEdit && !tool}>
          <ToolFormFields form={form} bucketOptions={bucketOptions} />
        </Card>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <ToolProbeCard form={form} />
          {isEdit && tool && <SavedToolTestCard tool={tool} />}
        </Space>
      </div>
    </>
  );
}

export function ToolTestPage() {
  const [tool, setTool] = useState<ToolRead | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toolId } = useParams();

  useEffect(() => {
    if (!toolId) return;
    setLoading(true);
    api
      .get<ToolRead>(`/api/enterprise/tools/${toolId}?tenant_id=${TENANT_ID}`)
      .then(setTool)
      .catch((error) => message.error(error instanceof Error ? error.message : '加载工具失败'))
      .finally(() => setLoading(false));
  }, [toolId]);

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={3}>工具测试</Typography.Title>
          <Typography.Text type="secondary">
            用测试参数直接调用已保存工具，检查员工后续调用时的实际返回。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/enterprise/tools')}>返回工具箱</Button>
          {tool && <Button onClick={() => navigate(`/enterprise/tools/${tool.id}/edit`)}>编辑工具</Button>}
        </Space>
      </div>
      <div className="tool-test-layout">
        <Card className="tool-test-overview-card" title="工具信息" loading={loading && !tool}>
          {tool && (
            <div className="tool-test-overview">
              <div className="tool-test-hero">
                <div className="tool-test-icon">
                  <ToolOutlined />
                </div>
                <div className="tool-test-hero-main">
                  <Typography.Text className="tool-test-eyebrow">{tool.bucket || '未分桶'}</Typography.Text>
                  <Typography.Title level={4}>{tool.display_name || tool.name}</Typography.Title>
                  <Typography.Paragraph type="secondary">{tool.description || '暂无描述'}</Typography.Paragraph>
                  <Space wrap>
                    <Tag color={tool.tool_type === 'mcp' ? 'geekblue' : undefined}>{toolTypeLabel(tool)}</Tag>
                    <Tag color={tool.enabled ? 'green' : 'default'}>{tool.enabled ? '已启用' : '已停用'}</Tag>
                    <Tag>{tool.method}</Tag>
                  </Space>
                </div>
              </div>
              <div className="tool-test-meta-grid">
                <div>
                  <span>工具 ID</span>
                  <strong>{tool.name}</strong>
                </div>
                <div>
                  <span>输入字段</span>
                  <strong>{schemaPropertyCount(tool.input_schema)}</strong>
                </div>
                <div>
                  <span>输出字段</span>
                  <strong>{schemaPropertyCount(tool.output_schema)}</strong>
                </div>
                <div>
                  <span>最近更新</span>
                  <strong>{formatDateTime(tool.updated_at)}</strong>
                </div>
              </div>
              <div className="tool-test-endpoint">
                <span>调用地址</span>
                <code>{tool.method} {tool.url}</code>
              </div>
              <div className="tool-test-schema-grid">
                <div className="tool-test-schema-panel">
                  <div className="tool-test-section-title">Input Schema</div>
                  <CodeBlock className="tool-test-code" code={formatJson(tool.input_schema)} language="json" />
                </div>
                <div className="tool-test-schema-panel">
                  <div className="tool-test-section-title">Output Schema</div>
                  <CodeBlock className="tool-test-code" code={formatJson(tool.output_schema)} language="json" />
                </div>
              </div>
            </div>
          )}
        </Card>
        {tool && <SavedToolTestCard tool={tool} standalone />}
      </div>
    </>
  );
}

function ToolFormFields({
  form,
  bucketOptions,
}: {
  form: FormInstance<ToolFormValues>;
  bucketOptions: { value: string; label: string }[];
}) {
  const toolType = Form.useWatch('tool_type', form) || 'http';
  const isMcp = toolType === 'mcp';
  return (
    <Form form={form} layout="vertical" initialValues={TOOL_FORM_INITIAL_VALUES}>
      <Form.Item name="name" label="工具名称" rules={[{ required: true }]}>
        <Input prefix={<ToolOutlined />} disabled={isMcp} />
      </Form.Item>
      <Form.Item name="display_name" label="展示名称"><Input /></Form.Item>
      {isMcp ? (
        <Form.Item label="工具类型">
          <Tag color="geekblue">MCP 工具（由 MCP 服务器发现）</Tag>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            该工具属于某个 MCP 工具集，连接方式与元信息由 MCP 服务器自动发现。请在对应的 MCP 服务器页面重新发现 / 同步以更新。
          </Typography.Paragraph>
        </Form.Item>
      ) : (
        <Form.Item name="tool_type" label="工具类型" rules={[{ required: true }]}>
          <Select
            disabled
            options={[
              { value: 'http', label: 'HTTP 工具' },
              { value: 'mcp', label: 'MCP 工具' },
            ]}
          />
        </Form.Item>
      )}
      <Form.Item name="bucket" label="工具分桶">
        <AutoComplete placeholder="选择或输入分桶" options={bucketOptions} />
      </Form.Item>
      <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
      {!isMcp && (
        <>
          <Form.Item name="method" label="HTTP Method">
            <Select options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="url" label="URL" rules={[{ required: true }]}>
            <Input placeholder="/api/mock/order/query" />
          </Form.Item>
          <Form.Item name="headers" label="Headers JSON"><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="auth" label="Auth JSON"><Input.TextArea rows={3} /></Form.Item>
        </>
      )}
      <Form.Item name="input_schema" label="Input Schema"><Input.TextArea rows={5} readOnly={isMcp} /></Form.Item>
      <Form.Item name="output_schema" label="Output Schema"><Input.TextArea rows={5} readOnly={isMcp} /></Form.Item>
      <Form.Item name="allowed_skills" label="Allowed Skills"><Input placeholder="skill_id_1,skill_id_2" /></Form.Item>
      <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
    </Form>
  );
}

function ToolProbeCard({ form }: { form: FormInstance<ToolFormValues> }) {
  const [sampleJson, setSampleJson] = useState('{}');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  async function probe() {
    let values: ToolFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const payload = buildToolPayload(values);
    if (!payload) return;
    let sampleArguments: Record<string, unknown>;
    try {
      sampleArguments = parseJson(sampleJson, {});
    } catch {
      message.error('测试参数不是合法 JSON');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post('/api/enterprise/tools/probe', {
        tenant_id: TENANT_ID,
        tool_type: payload.tool_type,
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        auth: payload.auth,
        mcp_config: payload.mcp_config,
        sample_arguments: sampleArguments,
      });
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '探测失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className="editor-card"
      title="配置探测"
      extra={<Button icon={<ExperimentOutlined />} loading={loading} onClick={() => void probe()}>探测</Button>}
    >
      <Typography.Paragraph type="secondary">
        不保存工具，直接用当前表单配置发起一次探测。
      </Typography.Paragraph>
      <Input.TextArea rows={5} value={sampleJson} onChange={(event) => setSampleJson(event.target.value)} />
      <Input.TextArea rows={8} value={result} readOnly style={{ marginTop: 12 }} />
    </Card>
  );
}

function SavedToolTestCard({ tool, standalone = false }: { tool: ToolRead; standalone?: boolean }) {
  const [testJson, setTestJson] = useState(() => JSON.stringify(exampleFromSchema(tool.input_schema), null, 2));
  const [testResult, setTestResult] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTestJson(JSON.stringify(exampleFromSchema(tool.input_schema), null, 2));
    setTestResult('');
  }, [tool.id, tool.input_schema]);

  async function test() {
    let argumentsJson: Record<string, unknown>;
    try {
      argumentsJson = parseJson(testJson, {});
    } catch {
      message.error('测试参数不是合法 JSON');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post(`/api/enterprise/tools/${tool.id}/test`, {
        tenant_id: TENANT_ID,
        arguments: argumentsJson,
      });
      setTestResult(JSON.stringify(response, null, 2));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '调用失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      className="tool-test-console-card"
      title={(
        <span className="tool-test-card-title">
          <ExperimentOutlined />
          {standalone ? '调用测试' : '已保存工具测试'}
        </span>
      )}
      extra={<Button type="primary" icon={<ExperimentOutlined />} loading={loading} onClick={() => void test()}>调用</Button>}
    >
      <div className="tool-test-console-intro">
        <Typography.Text type="secondary">
          调用已保存的「{tool.display_name || tool.name}」，用于验证员工实际可用的工具返回。
        </Typography.Text>
        <Tag>{toolTypeLabel(tool)}</Tag>
      </div>
      <div className="tool-test-editor-block">
        <div className="tool-test-section-title">测试参数</div>
        <Input.TextArea
          className="tool-test-json-input"
          autoSize={{ minRows: 6, maxRows: 12 }}
          value={testJson}
          onChange={(event) => setTestJson(event.target.value)}
        />
      </div>
      <div className="tool-test-editor-block">
        <div className="tool-test-result-head">
          <div className="tool-test-section-title">调用结果</div>
          <Tag color={testResult ? 'green' : 'default'}>{testResult ? '已返回' : '等待调用'}</Tag>
        </div>
        {testResult ? (
          <CodeBlock className="tool-test-result-code" code={testResult} language="json" />
        ) : (
          <div className="tool-test-empty-result">点击调用后，这里会显示工具返回、错误信息和原始 data。</div>
        )}
      </div>
    </Card>
  );
}

async function loadBucketOptions() {
  const rows = await api.get<ToolRead[]>(`/api/enterprise/tools?tenant_id=${TENANT_ID}`);
  return Array.from(new Set(['未分桶', ...rows.map((row) => row.bucket || '未分桶')]))
    .map((value) => ({ value, label: value }));
}

function toolToFormValues(row: ToolRead): ToolFormValues {
  return {
    ...TOOL_FORM_INITIAL_VALUES,
    ...row,
    bucket: row.bucket || '未分桶',
    tool_type: row.tool_type || 'http',
    headers: JSON.stringify(row.headers || {}, null, 2),
    auth: JSON.stringify(row.auth || {}, null, 2),
    mcp_config: JSON.stringify(row.mcp_config || {}, null, 2),
    input_schema: JSON.stringify(row.input_schema || {}, null, 2),
    output_schema: JSON.stringify(row.output_schema || {}, null, 2),
    allowed_skills: (row.allowed_skills || []).join(','),
  };
}

// -------------------------------------------------------------------------- //
// MCP 服务器（工具集）编辑页
// -------------------------------------------------------------------------- //

export function McpServerNewPage() {
  return <McpServerEditorPage mode="new" />;
}

export function McpServerEditPage() {
  return <McpServerEditorPage mode="edit" />;
}

type McpServerFormValues = {
  name?: string;
  display_name?: string;
  description?: string;
  bucket: string;
  transport: MCPTransport;
  url?: string;
  headers?: string;
  command?: string;
  args?: string;
  env?: string;
  cwd?: string;
  enabled: boolean;
};

const MCP_SERVER_INITIAL: McpServerFormValues = {
  bucket: 'MCP 工具',
  transport: 'streamable_http',
  url: '',
  headers: '{}',
  command: '',
  args: '',
  env: '{}',
  cwd: '',
  enabled: true,
};

type DiscoveredRow = MCPDiscoverResponse['tools'][number] & { selected: boolean };

function McpServerEditorPage({ mode }: { mode: 'new' | 'edit' }) {
  const [form] = Form.useForm<McpServerFormValues>();
  const [server, setServer] = useState<MCPServerRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredRow[]>([]);
  const navigate = useNavigate();
  const { serverId } = useParams();
  const isEdit = mode === 'edit';
  const transport = Form.useWatch('transport', form) || 'streamable_http';

  useEffect(() => {
    if (!isEdit) {
      form.setFieldsValue(MCP_SERVER_INITIAL);
      setServer(null);
      return;
    }
    if (!serverId) return;
    setLoading(true);
    api
      .get<MCPServerRead>(`/api/enterprise/mcp-servers/${serverId}?tenant_id=${TENANT_ID}`)
      .then((row) => {
        setServer(row);
        form.setFieldsValue(serverToFormValues(row));
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载 MCP 服务器失败'))
      .finally(() => setLoading(false));
  }, [form, isEdit, serverId]);

  function buildConnection(values: McpServerFormValues): MCPServerConnection | null {
    try {
      return {
        transport: values.transport,
        url: values.transport === 'streamable_http' || values.transport === 'sse' ? values.url || '' : null,
        headers: parseJson(values.headers || '{}', {}),
        command: values.transport === 'stdio' ? values.command || '' : null,
        args: parseArgs(values.args || ''),
        env: parseJson(values.env || '{}', {}),
        cwd: values.transport === 'stdio' ? values.cwd || null : null,
      };
    } catch {
      message.error('Headers 或 Env 不是合法 JSON');
      return null;
    }
  }

  async function buildPayload(): Promise<{ payload: Record<string, unknown>; connection: MCPServerConnection } | null> {
    let values: McpServerFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return null;
    }
    const connection = buildConnection(values);
    if (!connection) return null;
    return {
      connection,
      payload: {
        tenant_id: TENANT_ID,
        name: String(values.name || '').trim(),
        display_name: values.display_name,
        description: values.description,
        bucket: values.bucket || 'MCP 工具',
        connection,
        enabled: values.enabled,
      },
    };
  }

  async function save() {
    const built = await buildPayload();
    if (!built) return;
    setLoading(true);
    try {
      const saved = isEdit && serverId
        ? await api.put<MCPServerRead>(`/api/enterprise/mcp-servers/${serverId}`, built.payload)
        : await api.post<MCPServerRead>('/api/enterprise/mcp-servers', built.payload);
      message.success('已保存');
      setServer(saved);
      form.setFieldsValue(serverToFormValues(saved));
      if (!isEdit) {
        navigate(`/enterprise/tools/mcp/${saved.id}/edit`, { replace: true });
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function discover() {
    const built = await buildPayload();
    if (!built) return;
    setDiscovering(true);
    try {
      const response = server
        ? await api.post<MCPDiscoverResponse>(`/api/enterprise/mcp-servers/${server.id}/discover`, {
            tenant_id: TENANT_ID,
            connection: built.connection,
          })
        : await api.post<MCPDiscoverResponse>('/api/enterprise/mcp-servers/discover', {
            tenant_id: TENANT_ID,
            connection: built.connection,
          });
      if (!response.success) {
        message.error(response.error?.message || '发现工具失败');
        setDiscovered([]);
        return;
      }
      setDiscovered(response.tools.map((tool) => ({ ...tool, selected: !tool.imported })));
      message.success(`发现 ${response.tools.length} 个工具`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发现工具失败');
    } finally {
      setDiscovering(false);
    }
  }

  async function sync() {
    if (!server) {
      message.warning('请先保存 MCP 服务器，再同步工具');
      return;
    }
    const selected = discovered.filter((tool) => tool.selected).map((tool) => tool.name);
    if (discovered.length > 0 && selected.length === 0) {
      message.warning('请至少勾选一个要导入的工具');
      return;
    }
    setSyncing(true);
    try {
      const response = await api.post<MCPSyncResponse>(`/api/enterprise/mcp-servers/${server.id}/sync`, {
        tenant_id: TENANT_ID,
        tool_names: discovered.length > 0 ? selected : null,
      });
      if (!response.success) {
        message.error(response.error?.message || '同步失败');
        return;
      }
      message.success(`同步完成：新增 ${response.imported.length}，更新 ${response.updated.length}`);
      const refreshed = await api.get<MCPServerRead>(`/api/enterprise/mcp-servers/${server.id}?tenant_id=${TENANT_ID}`);
      setServer(refreshed);
      await discover();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  }

  const discoveredColumns: ColumnsType<DiscoveredRow> = [
    {
      title: '',
      dataIndex: 'selected',
      width: 40,
      render: (_, record) => (
        <Checkbox
          checked={record.selected}
          onChange={(event) =>
            setDiscovered((prev) =>
              prev.map((item) => (item.name === record.name ? { ...item, selected: event.target.checked } : item)),
            )
          }
        />
      ),
    },
    { title: '工具名', dataIndex: 'name', width: 160, ellipsis: true },
    { title: '描述', dataIndex: 'description', ellipsis: true, render: (value) => value || '—' },
    {
      title: '状态',
      dataIndex: 'imported',
      width: 96,
      render: (value) => (value ? <Tag color="green">已导入</Tag> : <Tag>未导入</Tag>),
    },
  ];

  return (
    <>
      <div className="page-title">
        <div>
          <Typography.Title level={3}>{isEdit ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</Typography.Title>
          <Typography.Text type="secondary">
            配置 MCP Server 连接方式即可，工具列表通过 tools/list 自动发现，无需手动填写每个工具的 Method 或 Schema。
          </Typography.Text>
        </div>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/enterprise/tools')}>返回工具箱</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={loading} onClick={() => void save()}>保存</Button>
        </Space>
      </div>
      <div className="grid-2">
        <Card className="editor-card" title="连接配置" loading={loading && isEdit && !server}>
          <Form form={form} layout="vertical" initialValues={MCP_SERVER_INITIAL}>
            <Form.Item name="name" label="服务器标识（唯一）" rules={[{ required: true }]}>
              <Input prefix={<ApiOutlined />} placeholder="例如 github_mcp" disabled={isEdit} />
            </Form.Item>
            <Form.Item name="display_name" label="展示名称"><Input placeholder="例如 GitHub MCP" /></Form.Item>
            <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
            <Form.Item name="bucket" label="工具分桶"><Input placeholder="MCP 工具" /></Form.Item>
            <Form.Item name="transport" label="连接方式（Transport）" rules={[{ required: true }]}>
              <Select options={TRANSPORT_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
            </Form.Item>
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              {TRANSPORT_OPTIONS.find((item) => item.value === transport)?.hint}
            </Typography.Paragraph>
            {(transport === 'streamable_http' || transport === 'sse') && (
              <>
                <Form.Item name="url" label="Server URL" rules={[{ required: true }]}>
                  <Input placeholder="https://example.com/mcp" />
                </Form.Item>
                <Form.Item name="headers" label="Headers JSON（可选）">
                  <Input.TextArea rows={4} placeholder={'{\n  "Authorization": "Bearer ${secret.MCP_TOKEN}"\n}'} />
                </Form.Item>
              </>
            )}
            {transport === 'stdio' && (
              <>
                <Form.Item name="command" label="启动命令" rules={[{ required: true }]}>
                  <Input placeholder="npx" />
                </Form.Item>
                <Form.Item name="args" label="命令参数（每行一个，或空格分隔）">
                  <Input.TextArea rows={3} placeholder={'-y\n@modelcontextprotocol/server-github'} />
                </Form.Item>
                <Form.Item name="env" label="环境变量 JSON（可选）">
                  <Input.TextArea rows={3} placeholder={'{\n  "GITHUB_TOKEN": "${secret.GITHUB_TOKEN}"\n}'} />
                </Form.Item>
                <Form.Item name="cwd" label="工作目录（可选）"><Input placeholder="/path/to/workdir" /></Form.Item>
              </>
            )}
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
          </Form>
        </Card>
        <Card
          className="editor-card"
          title="工具发现（tools/list）"
          extra={(
            <Space>
              <Button icon={<SyncOutlined />} loading={discovering} onClick={() => void discover()}>发现工具</Button>
              <Button type="primary" loading={syncing} disabled={!server} onClick={() => void sync()}>导入 / 同步</Button>
            </Space>
          )}
        >
          <Typography.Paragraph type="secondary">
            点击「发现工具」连接 MCP Server 并拉取工具列表；勾选需要导入的工具后点击「导入 / 同步」，工具会自动落入工具箱（含 Input/Output Schema）。
          </Typography.Paragraph>
          {discovered.length > 0 ? (
            <Table
              rowKey="name"
              size="small"
              columns={discoveredColumns}
              dataSource={discovered}
              pagination={false}
            />
          ) : (
            <Empty description={server ? '尚未发现工具，点击上方「发现工具」' : '保存后可发现并同步工具（也可先发现预览）'} />
          )}
        </Card>
      </div>
    </>
  );
}

function serverToFormValues(row: MCPServerRead): McpServerFormValues {
  const conn = row.connection;
  return {
    name: row.name,
    display_name: row.display_name,
    description: row.description,
    bucket: row.bucket || 'MCP 工具',
    transport: conn.transport,
    url: conn.url || '',
    headers: JSON.stringify(conn.headers || {}, null, 2),
    command: conn.command || '',
    args: (conn.args || []).join('\n'),
    env: JSON.stringify(conn.env || {}, null, 2),
    cwd: conn.cwd || '',
    enabled: row.enabled,
  };
}

function parseArgs(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.includes('\n')) {
    return trimmed
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

function transportLabel(transport: MCPTransport | string): string {
  return TRANSPORT_OPTIONS.find((item) => item.value === transport)?.label || String(transport);
}

function buildToolPayload(values: ToolFormValues) {
  try {
    return {
      tenant_id: TENANT_ID,
      name: String(values.name || '').trim(),
      display_name: values.display_name,
      description: values.description,
      bucket: values.bucket || '未分桶',
      tool_type: values.tool_type || 'http',
      method: values.method,
      url: values.url,
      headers: parseJson(values.headers, {}),
      auth: parseJson(values.auth, {}),
      mcp_config: values.tool_type === 'mcp' ? parseJson(values.mcp_config, {}) : {},
      input_schema: parseJson(values.input_schema, {}),
      output_schema: parseJson(values.output_schema, {}),
      allowed_skills: String(values.allowed_skills || '').split(',').map((item) => item.trim()).filter(Boolean),
      enabled: values.enabled,
    };
  } catch {
    message.error('JSON 配置格式不正确，请检查 Headers、Auth、Schema 或 MCP Config');
    return null;
  }
}

function buildBucketStats(rows: ToolRead[]) {
  const map = new Map<string, { bucket: string; total: number; enabled: number; disabled: number }>();
  rows.forEach((row) => {
    const bucket = row.bucket || '未分桶';
    const item = map.get(bucket) || { bucket, total: 0, enabled: 0, disabled: 0 };
    item.total += 1;
    if (row.enabled) item.enabled += 1;
    else item.disabled += 1;
    map.set(bucket, item);
  });
  return Array.from(map.values()).sort((a, b) => b.total - a.total || a.bucket.localeCompare(b.bucket));
}

function parseJson<T>(value: string, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value || {}, null, 2);
}

function schemaPropertyCount(schema: Record<string, unknown>): string {
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, unknown>
    : {};
  return `${Object.keys(properties).length}`;
}

function toolTypeLabel(tool: ToolRead): string {
  return tool.tool_type === 'mcp' ? 'MCP 工具' : 'HTTP 工具';
}

function formatDateTime(value: string): string {
  if (!value) return '-';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return value;
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function exampleFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === 'object'
    ? schema.properties as Record<string, Record<string, unknown>>
    : {};
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, exampleValue(key, value)]),
  );
}

function exampleValue(key: string, schema: Record<string, unknown>): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.type === 'integer') return 1;
  if (schema.type === 'number') return 1;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'array') return [];
  if (schema.type === 'object') return {};
  return `sample_${key}`;
}
