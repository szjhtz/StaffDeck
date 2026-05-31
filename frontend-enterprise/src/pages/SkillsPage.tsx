import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  HistoryOutlined,
  MoreOutlined,
  PlusOutlined,
  RollbackOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Dropdown, Modal, Row, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, TENANT_ID } from '../api/client';
import type { SkillRead, SkillVersionRead } from '../types';

const STATUS_LABELS: Record<SkillRead['status'], { text: string; color: string }> = {
  draft: { text: '草稿', color: 'blue' },
  published: { text: '已发布', color: 'green' },
  archived: { text: '已归档', color: 'default' },
};

type RankingMode = 'calls' | 'positive' | 'negative';
type RankedSkill = SkillRead & { rank: number };

export default function SkillsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SkillRead[]>([]);
  const [versionRows, setVersionRows] = useState<SkillVersionRead[]>([]);
  const [versionSkill, setVersionSkill] = useState<SkillRead | null>(null);
  const [detailVersion, setDetailVersion] = useState<SkillVersionRead | null>(null);
  const [rankingMode, setRankingMode] = useState<RankingMode | null>(null);
  const [versionModalTitle, setVersionModalTitle] = useState('');
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<SkillRead[]>(`/api/enterprise/skills?tenant_id=${TENANT_ID}`);
      setRows(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns: ColumnsType<SkillRead> = useMemo(
    () => [
      { title: '技能名称', dataIndex: 'name', width: 180, ellipsis: true },
      { title: '技能 ID', dataIndex: 'skill_id', width: 190, ellipsis: true },
      { title: '业务域', dataIndex: 'business_domain', width: 140, ellipsis: true },
      { title: '版本', dataIndex: 'version', width: 90 },
      {
        title: '状态',
        dataIndex: 'status',
        width: 110,
        render: (status: SkillRead['status']) => {
          const option = STATUS_LABELS[status] || { text: status, color: 'default' };
          return <Tag color={option.color}>{option.text}</Tag>;
        },
      },
      { title: '调用次数', dataIndex: 'call_count', width: 100 },
      {
        title: '好评率',
        dataIndex: 'positive_rate',
        width: 100,
        render: (value: number) => percent(value),
      },
      {
        title: '差评率',
        dataIndex: 'negative_rate',
        width: 100,
        render: (value: number) => percent(value),
      },
      {
        title: '操作',
        width: 80,
        fixed: 'right',
        render: (_, row) => (
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'edit', icon: <EditOutlined />, label: '编辑' },
                { key: 'versions', icon: <HistoryOutlined />, label: '版本管理' },
                { key: 'publish', icon: <CheckCircleOutlined />, label: '发布' },
                { key: 'archive', icon: <StopOutlined />, label: '下线' },
                { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
              ],
              onClick: ({ key }) => handleAction(key, row),
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="技能操作" />
          </Dropdown>
        ),
      },
    ],
    [],
  );

  const rankingRows = useMemo(
    () => ({
      calls: rankByMetric(rows, 'total_call_count'),
      positive: rankByMetric(rows, 'recent_positive_rate', 'recent_positive_feedback_count'),
      negative: rankByMetric(rows, 'recent_negative_rate', 'recent_negative_feedback_count'),
    }),
    [rows],
  );

  const rankingModalRows = rankingMode ? rankingRows[rankingMode] : [];
  const rankingModalTitle = rankingMode ? rankingTitle(rankingMode) : '完整排行';
  const rankingModalColumns = useMemo<ColumnsType<RankedSkill>>(
    () => [
      { title: '排名', dataIndex: 'rank', width: 80 },
      { title: '技能名称', dataIndex: 'name', ellipsis: true },
      { title: '技能 ID', dataIndex: 'skill_id', ellipsis: true },
      { title: '当前版本', dataIndex: 'version', width: 110 },
      { title: '业务域', dataIndex: 'business_domain', width: 140, ellipsis: true },
      {
        title: rankingMode === 'calls' ? '全历史调用' : '近三版本',
        width: 160,
        render: (_, row) => (rankingMode === 'calls' ? `${row.total_call_count || 0} 次` : recentVersionsText(row)),
      },
      {
        title: '近三版本调用',
        dataIndex: 'recent_call_count',
        width: 130,
        render: (value: number) => `${value || 0} 次`,
      },
      {
        title: '好评率',
        dataIndex: 'recent_positive_rate',
        width: 110,
        render: (value: number) => percent(value),
      },
      {
        title: '差评率',
        dataIndex: 'recent_negative_rate',
        width: 110,
        render: (value: number) => percent(value),
      },
      {
        title: '反馈数',
        width: 110,
        render: (_, row) => `${row.recent_positive_feedback_count || 0}/${row.recent_negative_feedback_count || 0}`,
      },
    ],
    [rankingMode],
  );

  function openCreate() {
    navigate('/enterprise/skills/distill?mode=create');
  }

  function openEdit(row: SkillRead) {
    navigate(`/enterprise/skills/distill?skill_id=${encodeURIComponent(row.skill_id)}`);
  }

  async function publish(row: SkillRead) {
    await api.post(`/api/enterprise/skills/${row.skill_id}/publish?tenant_id=${TENANT_ID}`);
    message.success('已发布');
    load();
  }

  async function archive(row: SkillRead) {
    await api.post(`/api/enterprise/skills/${row.skill_id}/archive?tenant_id=${TENANT_ID}`);
    message.success('已下线');
    load();
  }

  async function openVersions(row: SkillRead) {
    setVersionSkill(row);
    setVersionModalTitle(`版本管理：${row.name}`);
    setVersionModalOpen(true);
    try {
      const result = await api.get<SkillVersionRead[]>(
        `/api/enterprise/skills/${encodeURIComponent(row.skill_id)}/versions?tenant_id=${TENANT_ID}`,
      );
      setVersionRows(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载版本失败');
    }
  }

  async function showVersionDetail(row: SkillVersionRead) {
    try {
      const result = await api.get<SkillVersionRead>(
        `/api/enterprise/skills/${encodeURIComponent(row.skill_id)}/versions/${encodeURIComponent(row.version)}?tenant_id=${TENANT_ID}`,
      );
      setDetailVersion(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载版本详情失败');
    }
  }

  function rollbackVersion(row: SkillVersionRead) {
    Modal.confirm({
      title: `回滚到版本 ${row.version}？`,
      content: `当前技能将切换为「${row.name}」的 ${row.version} 版本内容，历史版本记录和历史反馈数据不会被删除。`,
      okText: '回滚',
      cancelText: '取消',
      onOk: async () => {
        const result = await api.post<SkillRead>(
          `/api/enterprise/skills/${encodeURIComponent(row.skill_id)}/versions/${encodeURIComponent(row.version)}/rollback?tenant_id=${TENANT_ID}`,
        );
        message.success(`已回滚到 ${row.version}`);
        await load();
        await openVersions(result);
      },
    });
  }

  function remove(row: SkillRead) {
    Modal.confirm({
      title: `删除技能「${row.name}」？`,
      content: '删除后不会移除历史会话记录，但技能列表中将不再显示该技能。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await api.delete(`/api/enterprise/skills/${row.skill_id}?tenant_id=${TENANT_ID}`);
        message.success('已删除');
        load();
      },
    });
  }

  function handleAction(key: string, row: SkillRead) {
    if (key === 'edit') openEdit(row);
    if (key === 'versions') void openVersions(row);
    if (key === 'publish') void publish(row);
    if (key === 'archive') void archive(row);
    if (key === 'delete') remove(row);
  }

  return (
    <>
      <div className="page-title">
        <Typography.Title level={3}>技能管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建
        </Button>
      </div>
      <Card className="data-card" title="技能列表">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1080 }}
          size="middle"
        />
      </Card>
      <Row gutter={[16, 16]} className="skill-rank-row">
        <Col xs={24} lg={8}>
          <RankingCard
            title="调用排行榜"
            rows={rankingRows.calls.slice(0, 5)}
            value={(row) => `${row.total_call_count || 0} 次`}
            onMore={() => setRankingMode('calls')}
          />
        </Col>
        <Col xs={24} lg={8}>
          <RankingCard
            title="好评排行榜"
            rows={rankingRows.positive.slice(0, 5)}
            value={(row) => percent(row.recent_positive_rate)}
            onMore={() => setRankingMode('positive')}
          />
        </Col>
        <Col xs={24} lg={8}>
          <RankingCard
            title="差评排行榜"
            rows={rankingRows.negative.slice(0, 5)}
            value={(row) => percent(row.recent_negative_rate)}
            onMore={() => setRankingMode('negative')}
          />
        </Col>
      </Row>
      <Modal
        open={Boolean(rankingMode)}
        title={rankingModalTitle}
        width={1080}
        footer={null}
        onCancel={() => setRankingMode(null)}
      >
        <Table
          rowKey="skill_id"
          dataSource={rankingModalRows}
          columns={rankingModalColumns}
          pagination={{ pageSize: 10, pageSizeOptions: [10, 15], showSizeChanger: true }}
          size="small"
          scroll={{ x: 960 }}
        />
      </Modal>
      <Modal
        open={versionModalOpen}
        title={versionModalTitle}
        width={1080}
        footer={null}
        onCancel={() => {
          setVersionModalOpen(false);
          setVersionSkill(null);
        }}
      >
        <Table
          rowKey="id"
          dataSource={versionRows}
          pagination={false}
          size="small"
          columns={[
            { title: '版本', dataIndex: 'version', width: 100 },
            { title: '技能名称', dataIndex: 'name', ellipsis: true },
            { title: '业务域', dataIndex: 'business_domain', width: 140, ellipsis: true },
            { title: '调用次数', dataIndex: 'call_count', width: 100 },
            { title: '好评率', dataIndex: 'positive_rate', width: 100, render: (value: number) => percent(value) },
            { title: '差评率', dataIndex: 'negative_rate', width: 100, render: (value: number) => percent(value) },
            { title: '更新时间', dataIndex: 'updated_at', width: 150, render: (value: string) => value.slice(0, 10) },
            {
              title: '操作',
              width: 80,
              fixed: 'right',
              render: (_, row) => (
                <Dropdown
                  trigger={['click']}
                  menu={{
                    items: [
                      { key: 'detail', icon: <EyeOutlined />, label: '查看详情' },
                      {
                        key: 'rollback',
                        icon: <RollbackOutlined />,
                        label: row.version === versionSkill?.version ? '当前版本' : '回滚到此版本',
                        disabled: row.version === versionSkill?.version,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key === 'detail') void showVersionDetail(row);
                      if (key === 'rollback') rollbackVersion(row);
                    },
                  }}
                >
                  <Button type="text" icon={<MoreOutlined />} aria-label="版本操作" />
                </Dropdown>
              ),
            },
          ]}
        />
      </Modal>
      <Modal
        open={Boolean(detailVersion)}
        title={detailVersion ? `版本详情：${detailVersion.name} / ${detailVersion.version}` : '版本详情'}
        width={920}
        footer={null}
        onCancel={() => setDetailVersion(null)}
      >
        {detailVersion && (
          <div className="version-detail">
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="技能 ID">{detailVersion.skill_id}</Descriptions.Item>
              <Descriptions.Item label="版本">{detailVersion.version}</Descriptions.Item>
              <Descriptions.Item label="业务域">{detailVersion.business_domain || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusText(detailVersion.status)}</Descriptions.Item>
              <Descriptions.Item label="调用次数">{detailVersion.call_count}</Descriptions.Item>
              <Descriptions.Item label="好评率">{percent(detailVersion.positive_rate)}</Descriptions.Item>
              <Descriptions.Item label="差评率">{percent(detailVersion.negative_rate)}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{detailVersion.updated_at.slice(0, 10)}</Descriptions.Item>
            </Descriptions>
            <pre className="version-detail-source">{skillSourceText(detailVersion)}</pre>
          </div>
        )}
      </Modal>
    </>
  );
}

function RankingCard({
  title,
  rows,
  value,
  onMore,
}: {
  title: string;
  rows: RankedSkill[];
  value: (row: RankedSkill) => string;
  onMore: () => void;
}) {
  return (
    <Card
      title={title}
      extra={
        <Button type="link" size="small" onClick={onMore}>
          查看更多
        </Button>
      }
      className="skill-ranking-card"
    >
      {rows.length === 0 ? (
        <Typography.Text type="secondary">暂无数据</Typography.Text>
      ) : (
        rows.map((row) => (
          <div className="skill-ranking-item" key={`${title}_${row.skill_id}`}>
            <span className="skill-ranking-index">{row.rank}</span>
            <span className="skill-ranking-name" title={row.name}>{row.name}</span>
            <strong>{value(row)}</strong>
          </div>
        ))
      )}
    </Card>
  );
}

function rankByMetric(
  rows: SkillRead[],
  field: 'total_call_count' | 'recent_positive_rate' | 'recent_negative_rate',
  tieBreaker?: 'recent_positive_feedback_count' | 'recent_negative_feedback_count',
): RankedSkill[] {
  return [...rows]
    .sort((a, b) => {
      const primary = (b[field] || 0) - (a[field] || 0);
      if (primary !== 0) return primary;
      if (tieBreaker) {
        const secondary = (b[tieBreaker] || 0) - (a[tieBreaker] || 0);
        if (secondary !== 0) return secondary;
      }
      return (b.total_call_count || 0) - (a.total_call_count || 0);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function percent(value: number | undefined): string {
  return `${Math.round((value || 0) * 100)}%`;
}

function rankingTitle(mode: RankingMode): string {
  if (mode === 'calls') return '完整排行：全历史调用';
  if (mode === 'positive') return '完整排行：近三版本好评率';
  return '完整排行：近三版本差评率';
}

function recentVersionsText(row: SkillRead): string {
  return row.recent_versions?.length ? row.recent_versions.join(' / ') : '-';
}

function statusText(status: string): string {
  return STATUS_LABELS[status as SkillRead['status']]?.text || status;
}

function skillSourceText(row: SkillVersionRead): string {
  const skill = row.content;
  return [
    `# ${skill.name}`,
    `- skill_id: ${skill.skill_id}`,
    `- version: ${skill.version}`,
    `- business_domain: ${skill.business_domain || '-'}`,
    `- description: ${skill.description || '-'}`,
    `- trigger_intents: ${formatList(skill.trigger_intents)}`,
    `- user_utterance_examples: ${formatList(skill.user_utterance_examples)}`,
    `- goal: ${formatList(skill.goal)}`,
    `- required_info: ${formatList(skill.required_info)}`,
    `- response_rules: ${formatList(skill.response_rules)}`,
    '',
    '## 详细步骤',
    ...skill.steps.flatMap((step, index) => [
      '',
      `### Step ${index + 1}: ${String(step.name || step.step_id || '-')}`,
      `- step_id: ${String(step.step_id || '-')}`,
      `- instruction: ${String(step.instruction || '-')}`,
      `- expected_user_info: ${formatList(step.expected_user_info)}`,
      `- allowed_actions: ${formatList(step.allowed_actions)}`,
    ]),
  ].join('\n');
}

function formatList(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '-';
  return value.map(String).join(', ');
}
