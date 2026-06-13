import { DislikeOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Descriptions, Drawer, Empty, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { api, TENANT_ID } from '../api/client';
import type { FeedbackAnalysisRead, FeedbackMessageRead, FeedbackSessionDetailRead, FeedbackSessionRead, FeedbackSummaryRead } from '../types';

export default function FeedbackPage() {
  const [rows, setRows] = useState<FeedbackSessionRead[]>([]);
  const [summary, setSummary] = useState<FeedbackSummaryRead | null>(null);
  const [detail, setDetail] = useState<FeedbackSessionDetailRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<FeedbackSessionRead[]>(
        `/api/enterprise/feedback/sessions?tenant_id=${TENANT_ID}&rating=down`,
      );
      const summaryResult = await api.get<FeedbackSummaryRead>(
        `/api/enterprise/feedback/summary?tenant_id=${TENANT_ID}`,
      );
      setRows(result);
      setSummary(summaryResult);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (row: FeedbackSessionRead) => {
    setDetailLoading(true);
    try {
      const result = await api.get<FeedbackSessionDetailRead>(
        `/api/enterprise/feedback/sessions/${row.session_id}?tenant_id=${TENANT_ID}`,
      );
      setDetail(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const reloadCurrentDetail = async () => {
    const sessionId = String(detail?.session?.id || detail?.session?.session_id || '');
    if (!sessionId) return;
    try {
      const result = await api.get<FeedbackSessionDetailRead>(
        `/api/enterprise/feedback/sessions/${sessionId}?tenant_id=${TENANT_ID}`,
      );
      setDetail(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '刷新详情失败');
    }
  };

  const reanalyzeFeedback = async (feedbackId: string) => {
    setReanalyzingId(feedbackId);
    try {
      await api.post(`/api/enterprise/feedback/${feedbackId}/reanalyze?tenant_id=${TENANT_ID}`);
      message.success('已重新提交后台分析');
      await reloadCurrentDetail();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新分析失败');
    } finally {
      setReanalyzingId(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const columns: ColumnsType<FeedbackSessionRead> = [
    {
      title: '会话',
      dataIndex: 'session_id',
      width: 230,
      ellipsis: true,
      render: (value, row) => row.title || value,
    },
    {
      title: '用户',
      width: 180,
      render: (_, row) => row.display_name || row.username || row.user_id || '-',
    },
    { title: '点踩数', dataIndex: 'feedback_count', width: 90 },
    {
      title: '主要归因',
      width: 160,
      render: (_, row) => <FeedbackBucketTag label={row.primary_bucket_label} bucket={row.primary_bucket} />,
    },
    {
      title: '最近点踩回复',
      dataIndex: 'latest_message',
      ellipsis: true,
      render: (value) => <span className="muted-cell">{value || '-'}</span>,
    },
    {
      title: '最近点踩时间',
      dataIndex: 'latest_feedback_at',
      width: 180,
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
      render: (_, row) => (
        <Button icon={<EyeOutlined />} onClick={() => openDetail(row)} loading={detailLoading}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <>
      <div className="page-title">
        <Typography.Title level={3}>负反馈会话</Typography.Title>
      </div>
      <Card
        className="data-card"
        title={<><DislikeOutlined /> 用户点踩汇总</>}
        extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>}
      >
        {summary && (
          <div className="feedback-summary-panel">
            <div className="feedback-summary-text">{summary.summary}</div>
            <Space wrap>
              <Tag>反馈 {summary.total_feedback}</Tag>
              <Tag color="red">点踩 {summary.down_count}</Tag>
              <Tag color="green">点赞 {summary.up_count}</Tag>
              {summary.bucket_counts.map((item) => (
                <Tag key={item.bucket} color={bucketColor(item.bucket)}>
                  {item.label} {item.count}
                </Tag>
              ))}
            </Space>
          </div>
        )}
        <Table
          rowKey="session_id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: <Empty description="暂无点踩会话" /> }}
          scroll={{ x: 1080 }}
        />
      </Card>
      <Drawer
        title="点踩会话详情"
        open={Boolean(detail)}
        width={860}
        onClose={() => setDetail(null)}
        destroyOnClose
      >
        {detail ? (
          <div className="feedback-detail">
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="会话 ID">{String(detail.session.session_id || detail.session.id || '-')}</Descriptions.Item>
              <Descriptions.Item label="用户">{displayUser(detail.session)}</Descriptions.Item>
              <Descriptions.Item label="状态">{String(detail.session.status || '-')}</Descriptions.Item>
              <Descriptions.Item label="点踩数">
                {detail.feedback.filter((item) => item.rating === 'down').length}
              </Descriptions.Item>
              <Descriptions.Item label="归因">
                <Space wrap>
                  {detail.feedback
                    .filter((item) => item.rating === 'down')
                    .map((item) => item.analysis as FeedbackAnalysisRead | undefined)
                    .filter(Boolean)
                    .map((analysis, index) => (
                      <FeedbackBucketTag
                        key={`${analysis?.bucket || 'unknown'}_${index}`}
                        label={analysis?.bucket_label}
                        bucket={analysis?.bucket}
                      />
                    ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
            <div className="feedback-conversation">
              {detail.messages.map((item) => (
                <FeedbackMessage
                  key={item.id}
                  item={item}
                  onReanalyze={reanalyzeFeedback}
                  reanalyzing={Boolean(item.feedback_id && item.feedback_id === reanalyzingId)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function FeedbackMessage({
  item,
  onReanalyze,
  reanalyzing,
}: {
  item: FeedbackMessageRead;
  onReanalyze: (feedbackId: string) => void;
  reanalyzing: boolean;
}) {
  const isUser = item.role === 'user';
  const isAssistant = item.role === 'assistant';
  const analysisFailed = item.feedback_analysis?.status === 'failed';
  return (
    <div className={`feedback-message-row ${isUser ? 'user' : 'assistant'}`}>
      <div className="feedback-message-bubble">
        <div className="feedback-message-meta">
          <span>{isUser ? '用户' : isAssistant ? '助手' : item.role}</span>
          <span>{new Date(item.created_at).toLocaleString()}</span>
          {item.feedback_rating === 'down' && <Tag color="red">点踩</Tag>}
          {item.feedback_rating === 'up' && <Tag color="green">点赞</Tag>}
          {item.feedback_analysis && (
            analysisFailed
              ? <Tag color="red">分析失败</Tag>
              : <FeedbackBucketTag label={item.feedback_analysis.bucket_label} bucket={item.feedback_analysis.bucket} />
          )}
        </div>
        <Typography.Paragraph className="feedback-message-content">
          {item.content}
        </Typography.Paragraph>
        {item.feedback_analysis && item.feedback_rating === 'down' && (
          <div className="feedback-analysis-box">
            <div>
              <strong>分析状态：</strong>{analysisStatusLabel(item.feedback_analysis.status)}
              {item.feedback_analysis.status !== 'failed' && typeof item.feedback_analysis.confidence === 'number' && (
                <span> · 置信度 {(item.feedback_analysis.confidence * 100).toFixed(0)}%</span>
              )}
            </div>
            {item.feedback_analysis.summary && <div><strong>总结：</strong>{item.feedback_analysis.summary}</div>}
            {item.feedback_analysis.reason && <div><strong>原因：</strong>{item.feedback_analysis.reason}</div>}
            {item.feedback_analysis.status === 'failed' && item.feedback_id && (
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={reanalyzing}
                onClick={() => onReanalyze(item.feedback_id as string)}
              >
                重新分析
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function displayUser(session: Record<string, unknown>): string {
  return String(session.display_name || session.username || session.user_id || '-');
}

function FeedbackBucketTag({ label, bucket }: { label?: string; bucket?: string }) {
  if (!label && !bucket) return <Tag>待分析</Tag>;
  return <Tag color={bucketColor(bucket)}>{label || bucket}</Tag>;
}

function bucketColor(bucket?: string): string {
  if (bucket === 'model_issue') return 'volcano';
  if (bucket === 'skill_issue') return 'orange';
  if (bucket === 'tool_or_system_issue') return 'purple';
  if (bucket === 'user_random_or_unclear') return 'default';
  if (bucket === 'positive_or_resolved') return 'green';
  if (bucket === 'needs_model_analysis') return 'blue';
  return 'default';
}

function analysisStatusLabel(status?: string): string {
  if (status === 'pending') return '等待分析';
  if (status === 'analyzed') return '已分析';
  if (status === 'failed') return '分析失败';
  if (status === 'needs_model') return '待配置模型';
  return status || '未知';
}
