import {
  ArrowLeftOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { AutoComplete, Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { FormInstance } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, TENANT_ID } from '../api/client';
import type { AgentProfileRead, ToolRead } from '../types';

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

type ToolFormValues = typeof TOOL_FORM_INITIAL_VALUES & {
  name?: string;
  display_name?: string;
  description?: string;
  allowed_skills?: string;
  url?: string;
};

export default function ToolsPage() {
  const [rows, setRows] = useState<ToolRead[]>([]);
  const [agentId, setAgentId] = useState(() => window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY) || '');
  const [isOverallAgent, setIsOverallAgent] = useState(true);
  const [bucketFilter, setBucketFilter] = useState('__all__');
  const [searchText, setSearchText] = useState('');
  const navigate = useNavigate();

  const load = () =>
    api
      .get<ToolRead[]>(`/api/enterprise/tools?tenant_id=${TENANT_ID}`)
      .then(setRows)
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
      } catch {
        setIsOverallAgent(true);
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

  const columns: ColumnsType<ToolRead> = [
    { title: '工具名称', dataIndex: 'name', width: 170, ellipsis: true },
    { title: '展示名称', dataIndex: 'display_name', width: 160, ellipsis: true },
    {
      title: '分桶',
      dataIndex: 'bucket',
      width: 130,
      render: (value) => <Tag className="tool-bucket-tag">{value || '未分桶'}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'tool_type',
      width: 88,
      render: (value) => <Tag color={value === 'mcp' ? 'geekblue' : undefined}>{value === 'mcp' ? 'MCP' : 'HTTP'}</Tag>,
    },
    { title: 'Method', dataIndex: 'method', width: 96 },
    { title: 'URL', dataIndex: 'url', width: 280, ellipsis: true },
    { title: '启用', dataIndex: 'enabled', width: 80, render: (value) => (value ? '是' : '否') },
    {
      title: '操作',
      width: 244,
      render: (_, row) => (
        <span className="table-actions">
          <Button size="small" onClick={() => navigate(`/enterprise/tools/${row.id}/edit`)}>编辑</Button>
          <Button size="small" icon={<ExperimentOutlined />} onClick={() => navigate(`/enterprise/tools/${row.id}/test`)}>测试</Button>
          {isOverallAgent && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void remove(row)}>删除</Button>}
        </span>
      ),
    },
  ];

  const visibleRows = useMemo(() => (isOverallAgent ? rows : rows.filter((row) => row.enabled)), [isOverallAgent, rows]);
  const bucketStats = useMemo(() => buildBucketStats(visibleRows), [visibleRows]);
  const filteredRows = useMemo(() => {
    const text = searchText.trim().toLowerCase();
    return visibleRows.filter((row) => {
      const bucketMatch = bucketFilter === '__all__' || (row.bucket || '未分桶') === bucketFilter;
      if (!bucketMatch) return false;
      if (!text) return true;
      return [
        row.name,
        row.display_name || '',
        row.description || '',
        row.bucket || '',
        row.url,
      ].some((value) => value.toLowerCase().includes(text));
    });
  }, [bucketFilter, searchText, visibleRows]);

  return (
    <>
      <div className="page-title">
        <Typography.Title level={3}>工具配置</Typography.Title>
        <Typography.Text type="secondary">
          {isOverallAgent ? '管理可开放给员工学习和调用的工具能力。' : '维护当前员工可调用的工具能力。'}
        </Typography.Text>
      </div>
      <Card
        className="data-card tools-list-card"
        title="工具列表"
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/enterprise/tools/new')}>新建工具</Button>
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
            placeholder="搜索工具名称、描述、URL 或分桶"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
          <Typography.Text type="secondary">当前显示 {filteredRows.length} / {visibleRows.length} 个工具</Typography.Text>
        </div>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filteredRows}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1080 }}
          size="middle"
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
          <Typography.Title level={3}>{isEdit ? '编辑工具' : '新建工具'}</Typography.Title>
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
      <div className="grid-2">
        <Card className="editor-card" title="工具信息" loading={loading && !tool}>
          {tool && (
            <Space direction="vertical" size={10}>
              <Typography.Title level={4}>{tool.display_name || tool.name}</Typography.Title>
              <Typography.Text type="secondary">{tool.description || '暂无描述'}</Typography.Text>
              <Space wrap>
                <Tag>{tool.bucket || '未分桶'}</Tag>
                <Tag color={tool.tool_type === 'mcp' ? 'geekblue' : undefined}>{tool.tool_type === 'mcp' ? 'MCP' : 'HTTP'}</Tag>
                <Tag color={tool.enabled ? 'green' : 'default'}>{tool.enabled ? '已启用' : '已停用'}</Tag>
              </Space>
              <Typography.Text code>{tool.method} {tool.url}</Typography.Text>
              <Input.TextArea rows={8} value={JSON.stringify(tool.input_schema, null, 2)} readOnly />
            </Space>
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
  return (
    <Form form={form} layout="vertical" initialValues={TOOL_FORM_INITIAL_VALUES}>
      <Form.Item name="name" label="工具名称" rules={[{ required: true }]}>
        <Input prefix={<ToolOutlined />} />
      </Form.Item>
      <Form.Item name="display_name" label="展示名称"><Input /></Form.Item>
      <Form.Item name="tool_type" label="工具类型" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'http', label: 'HTTP 工具' },
            { value: 'mcp', label: 'MCP 工具' },
          ]}
        />
      </Form.Item>
      <Form.Item name="bucket" label="工具分桶">
        <AutoComplete placeholder="选择或输入分桶" options={bucketOptions} />
      </Form.Item>
      <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
      <Form.Item name="method" label={toolType === 'mcp' ? 'Method 标记' : 'HTTP Method'}>
        <Select options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))} />
      </Form.Item>
      <Form.Item name="url" label={toolType === 'mcp' ? 'MCP URL 标记' : 'URL'} rules={[{ required: true }]}>
        <Input placeholder={toolType === 'mcp' ? 'mcp://builtin.demo/echo' : '/api/mock/order/query'} />
      </Form.Item>
      {toolType === 'mcp' ? (
        <Form.Item name="mcp_config" label="MCP Config JSON" rules={[{ required: true }]}>
          <Input.TextArea rows={4} placeholder={'{\n  "server": "builtin.demo",\n  "tool": "echo"\n}'} />
        </Form.Item>
      ) : (
        <>
          <Form.Item name="headers" label="Headers JSON"><Input.TextArea rows={4} /></Form.Item>
          <Form.Item name="auth" label="Auth JSON"><Input.TextArea rows={3} /></Form.Item>
        </>
      )}
      <Form.Item name="input_schema" label="Input Schema"><Input.TextArea rows={5} /></Form.Item>
      <Form.Item name="output_schema" label="Output Schema"><Input.TextArea rows={5} /></Form.Item>
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
      className="editor-card"
      title={standalone ? '调用测试' : '已保存工具测试'}
      extra={<Button icon={<ExperimentOutlined />} loading={loading} onClick={() => void test()}>调用</Button>}
    >
      <Typography.Paragraph type="secondary">
        调用已保存的「{tool.display_name || tool.name}」，用于验证员工实际可用的工具返回。
      </Typography.Paragraph>
      <Input.TextArea rows={5} value={testJson} onChange={(event) => setTestJson(event.target.value)} />
      <Input.TextArea rows={8} value={testResult} readOnly style={{ marginTop: 12 }} />
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
