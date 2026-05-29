import {
  BranchesOutlined,
  CodeOutlined,
  SaveOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Empty, Input, Space, Typography, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, streamPost, TENANT_ID } from '../api/client';
import type { SkillCard, SkillRead } from '../types';

type ChatItem = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type TargetSelection = {
  path: string;
  label: string;
};

type ViewMode = 'source' | 'flow';

const DEFAULT_TARGET: TargetSelection = { path: 'all', label: '整个技能' };

export default function DistillPage() {
  const [searchParams] = useSearchParams();
  const skillId = searchParams.get('skill_id');
  const [draft, setDraft] = useState<SkillCard | null>(null);
  const [loadedSkill, setLoadedSkill] = useState<SkillRead | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: '请粘贴原始技能说明，或点击右侧某一块后告诉我需要怎样改写。',
    },
  ]);
  const [input, setInput] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<TargetSelection>(DEFAULT_TARGET);
  const [viewMode, setViewMode] = useState<ViewMode>('source');
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!skillId) {
      setDraft(null);
      setLoadedSkill(null);
      setWarnings([]);
      setSelectedTarget(DEFAULT_TARGET);
      return;
    }
    api
      .get<SkillRead>(`/api/enterprise/skills/${encodeURIComponent(skillId)}?tenant_id=${TENANT_ID}`)
      .then((result) => {
        setDraft(result.content);
        setLoadedSkill(result);
        setSelectedTarget(DEFAULT_TARGET);
        setMessages([
          {
            id: 'loaded',
            role: 'assistant',
            content: `已加载「${result.name}」。点击右侧基础信息或步骤后，可以让我只改这一部分。`,
          },
        ]);
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载技能失败'));
  }, [skillId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const sourceMarkdown = useMemo(() => (draft ? skillToMarkdown(draft) : ''), [draft]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    pushMessage('user', text);
    if (!draft) {
      await createDraftFromText(text);
      return;
    }
    await rewriteSelectedTarget(text);
  }

  async function createDraftFromText(text: string) {
    const payload = parseInitialSkillPrompt(text);
    setLoading(true);
    setStreamStatus('正在生成技能草稿');
    const assistantId = pushMessage('assistant', '正在生成技能草稿...');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamPost(
        '/api/enterprise/skills/distill/stream',
        { tenant_id: TENANT_ID, ...payload },
        (item) => {
          if (item.event === 'complete') {
            const draftSkill = item.data.draft_skill as SkillCard;
            const nextWarnings = Array.isArray(item.data.warnings) ? item.data.warnings.map(String) : [];
            setDraft(draftSkill);
            setWarnings(nextWarnings);
            setSelectedTarget(DEFAULT_TARGET);
            updateMessage(
              assistantId,
              `已生成「${draftSkill.name}」草稿。现在可以点击右侧任意部分继续局部改写。`,
            );
            setStreamStatus('生成完成');
          }
        },
        controller.signal,
      );
    } catch (error) {
      updateMessage(assistantId, '生成失败，当前草稿未变更。');
      if (controller.signal.aborted) {
        message.info('已停止生成');
      } else {
        message.error(error instanceof Error ? error.message : '生成失败');
      }
    } finally {
      finishStream(controller);
    }
  }

  async function rewriteSelectedTarget(text: string) {
    if (!draft) return;
    setLoading(true);
    setStreamStatus(`正在改写：${selectedTarget.label}`);
    const assistantId = pushMessage('assistant', '');
    const controller = new AbortController();
    let receivedMessageChunk = false;
    abortRef.current = controller;
    try {
      await streamPost(
        `/api/enterprise/skills/${encodeURIComponent(draft.skill_id)}/rewrite/stream`,
        {
          tenant_id: TENANT_ID,
          current_skill: draft,
          instruction: text,
          target_path: selectedTarget.path,
          target_label: selectedTarget.label,
          conversation: messages.map((item) => ({ role: item.role, content: item.content })),
        },
        (item) => {
          if (item.event === 'message_chunk') {
            const content = typeof item.data.content === 'string' ? item.data.content : '';
            if (content) {
              receivedMessageChunk = true;
              appendMessage(assistantId, content);
            }
            return;
          }
          if (item.event === 'complete') {
            const nextDraft = item.data.draft_skill as SkillCard;
            const nextWarnings = Array.isArray(item.data.warnings) ? item.data.warnings.map(String) : [];
            setDraft(nextDraft);
            setWarnings(nextWarnings);
            setStreamStatus('改写完成');
            if (!receivedMessageChunk) {
              updateMessage(assistantId, String(item.data.assistant_message || '已完成局部改写。'));
            }
          }
        },
        controller.signal,
      );
    } catch (error) {
      updateMessage(assistantId, '改写失败，当前草稿未变更。');
      if (controller.signal.aborted) {
        message.info('已停止改写');
      } else {
        message.error(error instanceof Error ? error.message : '改写失败');
      }
    } finally {
      finishStream(controller);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    try {
      if (loadedSkill) {
        await api.put(`/api/enterprise/skills/${loadedSkill.skill_id}`, {
          tenant_id: TENANT_ID,
          content: draft,
          status: loadedSkill.status,
        });
      } else {
        try {
          await api.post('/api/enterprise/skills', { tenant_id: TENANT_ID, content: draft, status: 'draft' });
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes('409')) throw error;
          await api.put(`/api/enterprise/skills/${draft.skill_id}`, {
            tenant_id: TENANT_ID,
            content: draft,
            status: 'draft',
          });
        }
      }
      message.success('草稿已保存');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败');
    }
  }

  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStreamStatus('已停止');
  }

  function selectTarget(target: TargetSelection) {
    setSelectedTarget(target);
    pushMessage('assistant', `已选中：${target.label}。请告诉我你想怎样改写这一部分。`);
  }

  function pushMessage(role: ChatItem['role'], content: string) {
    const id = `${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setMessages((current) => [...current, { id, role, content }]);
    return id;
  }

  function updateMessage(id: string, content: string) {
    setMessages((current) => current.map((item) => (item.id === id ? { ...item, content } : item)));
  }

  function appendMessage(id: string, content: string) {
    setMessages((current) =>
      current.map((item) => (item.id === id ? { ...item, content: `${item.content}${content}` } : item)),
    );
  }

  function finishStream(controller: AbortController) {
    if (abortRef.current === controller) abortRef.current = null;
    setLoading(false);
  }

  return (
    <>
      <div className="page-title">
        <Typography.Title level={3}>技能改写</Typography.Title>
        <Typography.Text type="secondary">当前选中：{selectedTarget.label}</Typography.Text>
      </div>
      <div className="skill-workbench">
        <Card className="skill-chat-card" title="改写对话">
          <div className="skill-chat-panel">
            <div className="skill-chat-messages">
              {messages.map((item) => (
                <div key={item.id} className={`skill-chat-row ${item.role}`}>
                  <div className="skill-chat-bubble">{item.content || '正在处理...'}</div>
                </div>
              ))}
            </div>
            <div className="skill-chat-composer">
              <Input.TextArea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPressEnter={(event) => {
                  if (!event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={4}
                placeholder={
                  draft
                    ? '说明你要如何改写选中的部分'
                    : '输入“标题：... 原始SOP文本：...”或直接粘贴流程说明'
                }
              />
              <div className="skill-chat-actions">
                <Typography.Text type="secondary">{streamStatus}</Typography.Text>
                <Space>
                  {loading && (
                    <Button icon={<StopOutlined />} onClick={stopStream}>
                      停止
                    </Button>
                  )}
                  <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={() => void send()}>
                    发送
                  </Button>
                </Space>
              </div>
            </div>
          </div>
        </Card>
        <Card
          className="skill-source-card"
          title="技能结构"
          extra={
            <Button disabled={!draft || loading} icon={<SaveOutlined />} onClick={saveDraft}>
              保存草稿
            </Button>
          }
        >
          <div className="skill-source-toolbar">
            <Button
              icon={viewMode === 'source' ? <BranchesOutlined /> : <CodeOutlined />}
              onClick={() => setViewMode(viewMode === 'source' ? 'flow' : 'source')}
            >
              {viewMode === 'source' ? '显示流程' : '显示源码'}
            </Button>
            <Typography.Text type="secondary">{viewMode === 'source' ? '源码' : '流程图'}</Typography.Text>
          </div>
          {warnings.map((warning) => (
            <Alert key={warning} type="warning" message={warning} showIcon className="skill-warning" />
          ))}
          {!draft ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无技能草稿" />
          ) : viewMode === 'source' ? (
            <SkillSource
              markdown={sourceMarkdown}
              skill={draft}
              selectedPath={selectedTarget.path}
              onSelect={selectTarget}
            />
          ) : (
            <SkillFlow skill={draft} selectedPath={selectedTarget.path} onSelect={selectTarget} />
          )}
        </Card>
      </div>
    </>
  );
}

function SkillSource({
  markdown,
  skill,
  selectedPath,
  onSelect,
}: {
  markdown: string;
  skill: SkillCard;
  selectedPath: string;
  onSelect: (target: TargetSelection) => void;
}) {
  return (
    <div className="skill-source-md">
      <button
        type="button"
        className={`skill-source-section ${selectedPath === 'basic' ? 'active' : ''}`}
        onClick={() => onSelect({ path: 'basic', label: '基础信息' })}
      >
        <pre>{markdown.split('\n## Steps')[0]}</pre>
      </button>
      <div className="skill-source-steps">
        {skill.steps.map((step, index) => {
          const stepId = String(step.step_id || `step_${index + 1}`);
          const path = `steps.${stepId}`;
          return (
            <button
              type="button"
              key={path}
              className={`skill-source-section ${selectedPath === path ? 'active' : ''}`}
              onClick={() => onSelect({ path, label: `步骤 ${index + 1}：${step.name || stepId}` })}
            >
              <pre>{stepToMarkdown(step, index)}</pre>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SkillFlow({
  skill,
  selectedPath,
  onSelect,
}: {
  skill: SkillCard;
  selectedPath: string;
  onSelect: (target: TargetSelection) => void;
}) {
  return (
    <div className="skill-flow">
      <button
        type="button"
        className={`skill-flow-node root ${selectedPath === 'basic' ? 'active' : ''}`}
        onClick={() => onSelect({ path: 'basic', label: '基础信息' })}
      >
        <span>基础信息</span>
        <strong>{skill.name}</strong>
        <small>{skill.skill_id}</small>
      </button>
      {skill.steps.map((step, index) => {
        const stepId = String(step.step_id || `step_${index + 1}`);
        const path = `steps.${stepId}`;
        const toolActions = asStringList(step.allowed_actions).filter((action) =>
          String(action).startsWith('call_tool:'),
        );
        return (
          <div className="skill-flow-step" key={path}>
            <div className="skill-flow-line" />
            <button
              type="button"
              className={`skill-flow-node ${selectedPath === path ? 'active' : ''}`}
              onClick={() => onSelect({ path, label: `步骤 ${index + 1}：${step.name || stepId}` })}
            >
              <span>Step {index + 1}</span>
              <strong>{String(step.name || stepId)}</strong>
              <small>{stepId}</small>
            </button>
            {toolActions.length > 0 && (
              <div className="skill-flow-tools">
                {toolActions.map((action) => (
                  <div className="skill-flow-tool" key={String(action)}>
                    {String(action).replace('call_tool:', '')}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function parseInitialSkillPrompt(text: string): { title: string; raw_content: string } {
  const titleMatch = text.match(/标题[:：]\s*([^\n，,]+)/);
  const rawMatch = text.match(/原始(?:SOP|技能)?文本[:：]?\s*([\s\S]+)/);
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const title = titleMatch?.[1]?.trim() || lines[0]?.slice(0, 32) || '新技能';
  const rawContent = rawMatch?.[1]?.trim() || lines.slice(titleMatch ? 0 : 1).join('\n') || text;
  return { title, raw_content: rawContent };
}

function skillToMarkdown(skill: SkillCard): string {
  return [
    `# ${skill.name}`,
    '',
    '## 基础信息',
    `- skill_id: \`${skill.skill_id}\``,
    `- version: \`${skill.version}\``,
    `- business_domain: ${skill.business_domain || '-'}`,
    `- description: ${skill.description || '-'}`,
    `- trigger_intents: ${joinList(skill.trigger_intents)}`,
    `- user_utterance_examples: ${joinList(skill.user_utterance_examples)}`,
    `- goal: ${joinList(skill.goal)}`,
    `- required_info: ${joinList(skill.required_info)}`,
    `- response_rules: ${joinList(skill.response_rules)}`,
    '',
    '## Steps',
    ...skill.steps.map((step, index) => stepToMarkdown(step, index)),
  ].join('\n');
}

function stepToMarkdown(step: Record<string, unknown>, index: number): string {
  return [
    `### Step ${index + 1}: ${String(step.name || '-')}`,
    `- step_id: \`${String(step.step_id || '-')}\``,
    `- instruction: ${String(step.instruction || '-')}`,
    `- expected_user_info: ${joinList(asStringList(step.expected_user_info))}`,
    `- allowed_actions: ${joinList(asStringList(step.allowed_actions))}`,
  ].join('\n');
}

function joinList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.map((item) => `\`${item}\``).join(', ') : '-';
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
