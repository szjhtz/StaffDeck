import { ExperimentOutlined, ToolOutlined } from '../icons';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Copy, FlaskConical, Users } from 'lucide-react';

import { api, TENANT_ID } from '../api/client';
import type { EnterpriseAuthUser } from '../auth';
import AppHeader from '@/components/AppHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { Paginator } from '@/components/Paginator';
import { ResourceImportDialog } from '@/components/ResourceImportDialog';
import { StatCard } from '@/components/StatCard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Select as UISelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from '@/components/ui';
import { Button as UIButton } from '@/components/ui/button';
import { notify } from '@/components/ui/app-toast';
import { cn } from '@/lib/utils';
import {
  MENU_CONTENT_CLASS,
  MENU_ITEM_CLASS,
  MENU_ITEM_DANGER_CLASS,
  MOBILE_CARD_CLASS,
  SELECT_TRIGGER_CLASS,
  formatDateTime,
} from '@/lib/enterprise-ui';
import CodeBlock from '../components/CodeBlock';
import IconAdd from '../assets/icons/add.svg?react';
import IconArrowRight from '../assets/icons/arrow-right.svg?react';
import IconChevronDown from '../assets/icons/chevron-down.svg?react';
import IconClear from '../assets/icons/field-clear.svg?react';
import IconEdit from '../assets/icons/edit.svg?react';
import IconMore from '../assets/icons/more.svg?react';
import IconRefresh from '../assets/icons/refresh.svg?react';
import IconSearch from '../assets/icons/search.svg?react';
import IconTool from '../assets/icons/plaza-tool.svg?react';
import IconTrash from '../assets/icons/trash.svg?react';
import { canManageEmployeeAgent, resourceCreatorNameOrAdmin, visibleEmployeeAgents } from '../employee';
import { useClientPagination } from '../hooks/useClientPagination';
import { StatusBadge } from './scheduled-tasks/StatusBadge';
import type { AgentProfileRead, ToolRead } from '../types';

type ToolPageProps = {
  currentUser?: EnterpriseAuthUser;
  onLogout?: () => void;
};

const ENTERPRISE_AGENT_STORAGE_KEY = 'ultrarag_enterprise_agent_scope';
const TOOL_PAGE_SIZE = 10;
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

export default function ToolsPage({ currentUser, onLogout }: ToolPageProps = {}) {
  const [rows, setRows] = useState<ToolRead[]>([]);
  const [agentId, setAgentId] = useState(() => window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY) || '');
  const [isOverallAgent, setIsOverallAgent] = useState(true);
  const [agentScopeLoaded, setAgentScopeLoaded] = useState(false);
  const [bucketFilter, setBucketFilter] = useState('__all__');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentProfileRead[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'plaza' | 'employee'>('plaza');
  const [importTargetAgentId, setImportTargetAgentId] = useState('');
  const [importSourceAgentId, setImportSourceAgentId] = useState('');
  const [importSourceTools, setImportSourceTools] = useState<ToolRead[]>([]);
  const [importSelectedToolIds, setImportSelectedToolIds] = useState<string[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ToolRead | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const pageTitle = isOverallAgent ? '工具广场' : '工具';
  const listLabel = isOverallAgent ? '工具广场列表' : '员工工具';

  const agentQuery = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
  const load = () => {
    setLoading(true);
    return api
      .get<ToolRead[]>(`/api/enterprise/tools?tenant_id=${TENANT_ID}${agentQuery}`)
      .then(setRows)
      .catch((error) => notify.error(error instanceof Error ? error.message : '加载工具失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentQuery]);

  useEffect(() => {
    const loadAgentScope = async () => {
      try {
        const agents = await api.get<AgentProfileRead[]>(`/api/enterprise/agents?tenant_id=${TENANT_ID}`);
        setAgents(agents);
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
    const resourceId = searchParams.get('resourceId') || undefined;
    void openImportTools('plaza', resourceId);
    const next = new URLSearchParams(searchParams);
    next.delete('add');
    next.delete('resourceId');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentScopeLoaded, isOverallAgent, searchParams, setSearchParams]);

  const visibleRows = useMemo(() => (isOverallAgent ? rows : rows.filter((row) => row.enabled)), [isOverallAgent, rows]);
  const bucketStats = useMemo(() => buildBucketStats(visibleRows), [visibleRows]);
  const bucketSelectOptions = useMemo(
    () => [
      { value: '__all__', label: '全部分桶' },
      ...bucketStats.map((item) => ({ value: item.bucket, label: `${item.bucket} (${item.total})` })),
    ],
    [bucketStats],
  );
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
        resourceCreatorNameOrAdmin(row),
      ].some((value) => value.toLowerCase().includes(text));
    });
  }, [bucketFilter, searchText, visibleRows]);

  const pagination = useClientPagination(filteredRows, TOOL_PAGE_SIZE, `${searchText}|${bucketFilter}|${isOverallAgent}`);

  const stats = useMemo(
    () => ({
      total: visibleRows.length,
      enabled: visibleRows.filter((row) => row.enabled).length,
      buckets: bucketStats.length,
    }),
    [visibleRows, bucketStats],
  );

  async function confirmDelete() {
    const row = deleteTarget;
    if (!row) return;
    setDeleting(true);
    try {
      const agentSuffix = agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
      await api.delete(`/api/enterprise/tools/${row.id}?tenant_id=${TENANT_ID}${agentSuffix}`);
      notify.success(isOverallAgent ? '已删除工具' : '已从当前员工移除');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : isOverallAgent ? '删除失败' : '移除失败');
    } finally {
      setDeleting(false);
    }
  }

  function handleCreateAction(key: string) {
    if (key === 'blank') {
      navigate('/enterprise/tools/new');
      return;
    }
    if (key === 'plaza') {
      void openImportTools('plaza');
      return;
    }
    if (key === 'employee') {
      void openImportTools('employee');
    }
  }

  async function openImportTools(mode: 'plaza' | 'employee' = 'plaza', selectedResourceId?: string) {
    try {
      const agentRows = agents.length
        ? agents
        : await api.get<AgentProfileRead[]>(`/api/enterprise/agents?tenant_id=${TENANT_ID}`);
      setAgents(agentRows);
      setImportMode(mode);
      const targetCandidates = importTargetCandidates(agentRows);
      const nextTargetAgentId =
        targetCandidates.find((item) => item.id === agentId)?.id
        || targetCandidates[0]?.id
        || '';
      if (!nextTargetAgentId) {
        notify.warning('请先创建或选择一个数字员工，再复制工具');
        return;
      }
      setImportTargetAgentId(nextTargetAgentId);
      const candidates = mode === 'plaza'
        ? agentRows.filter((item) => item.id !== nextTargetAgentId && item.is_overall)
        : visibleEmployeeAgents(agentRows, currentUser, { activeOnly: true, excludeAgentId: nextTargetAgentId });
      const firstSource = candidates[0]?.id || '';
      setImportSourceAgentId(firstSource);
      setImportSelectedToolIds([]);
      setImportOpen(true);
      if (firstSource) {
        const sourceRows = await loadImportSourceTools(firstSource);
        if (selectedResourceId && sourceRows.some((item) => item.id === selectedResourceId)) {
          setImportSelectedToolIds([selectedResourceId]);
        }
      } else {
        setImportSourceTools([]);
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '加载员工失败');
    }
  }

  async function loadImportSourceTools(sourceAgentId: string): Promise<ToolRead[]> {
    setImportSourceTools([]);
    setImportSelectedToolIds([]);
    if (!sourceAgentId) return [];
    try {
      const sourceRows = await api.get<ToolRead[]>(
        `/api/enterprise/tools?tenant_id=${TENANT_ID}&agent_id=${encodeURIComponent(sourceAgentId)}`,
      );
      const enabledRows = sourceRows.filter((item) => item.enabled);
      setImportSourceTools(enabledRows);
      return enabledRows;
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '加载来源工具失败');
      return [];
    }
  }

  async function submitImportTools() {
    const targetAgentId = importTargetAgentId || (!isOverallAgent ? agentId : '');
    if (!targetAgentId) {
      notify.warning('请选择要复制到的数字员工');
      return;
    }
    if (!importSourceAgentId) {
      notify.warning(importMode === 'plaza' ? '请选择工具广场' : '请选择复制来源员工');
      return;
    }
    if (importSelectedToolIds.length === 0) {
      notify.warning('请选择要复制的工具');
      return;
    }
    setImportLoading(true);
    try {
      const result = await api.post<{ imported: Array<Record<string, unknown>>; missing: Array<Record<string, unknown>> }>(
        `/api/enterprise/agents/${targetAgentId}/resources/import`,
        {
          tenant_id: TENANT_ID,
          source_agent_id: importSourceAgentId,
          resource_type: 'tool',
          resource_ids: importSelectedToolIds,
        },
      );
      const importedCount = result.imported?.length || 0;
      const missingCount = result.missing?.length || 0;
      notify.success(`已复制 ${importedCount} 个工具${missingCount ? `，${missingCount} 个未复制` : ''}`);
      setImportOpen(false);
      if (targetAgentId !== agentId) {
        window.localStorage.setItem(ENTERPRISE_AGENT_STORAGE_KEY, targetAgentId);
        window.dispatchEvent(new CustomEvent('ultrarag-enterprise-agent-scope-change', { detail: { agentId: targetAgentId } }));
        setAgentId(targetAgentId);
      } else {
        await load();
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '复制工具失败');
    } finally {
      setImportLoading(false);
    }
  }

  function importTargetCandidates(agentRows: AgentProfileRead[] = agents): AgentProfileRead[] {
    return agentRows.filter((item) => (
      !item.is_overall
      && item.status === 'active'
      && canManageEmployeeAgent(item, currentUser)
    ));
  }

  function handleImportTargetChange(nextTargetAgentId: string) {
    setImportTargetAgentId(nextTargetAgentId);
    if (importMode !== 'employee' || importSourceAgentId !== nextTargetAgentId) return;
    const nextSource = visibleEmployeeAgents(agents, currentUser, {
      activeOnly: true,
      excludeAgentId: nextTargetAgentId,
    })[0]?.id || '';
    setImportSourceAgentId(nextSource);
    void loadImportSourceTools(nextSource);
  }

  function renderActions(row: ToolRead) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="工具操作"
          className="ml-auto grid size-7 place-items-center rounded-[8px] text-[#1a71ff] transition-colors outline-none hover:bg-black/5 hover:text-[#4a8dff] focus-visible:bg-black/5"
        >
          <IconMore className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={MENU_CONTENT_CLASS}>
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => navigate(`/enterprise/tools/${row.id}/edit`)}>
            <IconEdit />
            编辑
          </DropdownMenuItem>
          <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => navigate(`/enterprise/tools/${row.id}/test`)}>
            <FlaskConical />
            测试
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-[2px] bg-[#eef0f4]" />
          <DropdownMenuItem
            variant="destructive"
            className={MENU_ITEM_DANGER_CLASS}
            onSelect={() => setDeleteTarget(row)}
          >
            <IconTrash />
            {isOverallAgent ? '删除' : '移除'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const columns: DataTableColumn<ToolRead>[] = [
    {
      key: 'name',
      title: '工具名称',
      width: 200,
      className: 'text-[#18181a]',
      render: (row) => (
        <div className="flex min-w-0 flex-col gap-[2px]">
          <span className="truncate font-medium leading-[18px] text-[#18181a]" title={row.display_name || row.name}>
            {row.display_name || row.name}
          </span>
          <span className="truncate text-[#858b9c]" title={row.name}>
            {row.name}
          </span>
        </div>
      ),
    },
    {
      key: 'bucket',
      title: '分桶',
      width: 130,
      render: (row) => <StatusBadge tone="gray">{row.bucket || '未分桶'}</StatusBadge>,
    },
    {
      key: 'type',
      title: '类型',
      width: 90,
      render: (row) => (
        <StatusBadge tone={row.tool_type === 'mcp' ? 'blue' : 'gray'}>{row.tool_type === 'mcp' ? 'MCP' : 'HTTP'}</StatusBadge>
      ),
    },
    {
      key: 'creator',
      title: '创建者',
      width: 120,
      render: (row) => (
        <span className="block truncate text-[#858b9c]" title={resourceCreatorNameOrAdmin(row)}>
          {resourceCreatorNameOrAdmin(row)}
        </span>
      ),
    },
    { key: 'method', title: 'Method', width: 96, render: (row) => row.method },
    {
      key: 'url',
      title: 'URL',
      className: 'whitespace-normal',
      render: (row) => <span className="line-clamp-1 wrap-break-word text-[#858b9c]">{row.url}</span>,
    },
    {
      key: 'enabled',
      title: '启用',
      width: 90,
      render: (row) => (
        <StatusBadge tone={row.enabled ? 'green' : 'gray'}>{row.enabled ? '已启用' : '已停用'}</StatusBadge>
      ),
    },
    {
      key: 'actions',
      title: '操作',
      width: 70,
      align: 'right',
      render: (row) => renderActions(row),
    },
  ];

  const renderMobileCard = (row: ToolRead) => (
    <article className={MOBILE_CARD_CLASS} key={row.id}>
      <div className="flex min-w-0 items-start justify-between gap-[10px]">
        <div className="min-w-0">
          <strong className="block truncate text-[14px] font-semibold text-[#18181a]">
            {row.display_name || row.name}
          </strong>
          <span className="mt-[2px] block truncate text-[12px] text-[#858b9c]">{row.name}</span>
          <span className="mt-[2px] block truncate text-[12px] text-[#858b9c]">创建者：{resourceCreatorNameOrAdmin(row)}</span>
        </div>
        {renderActions(row)}
      </div>
      <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
        <StatusBadge tone="gray">{row.bucket || '未分桶'}</StatusBadge>
        <StatusBadge tone={row.tool_type === 'mcp' ? 'blue' : 'gray'}>{row.tool_type === 'mcp' ? 'MCP' : 'HTTP'}</StatusBadge>
        <StatusBadge tone={row.enabled ? 'green' : 'gray'}>{row.enabled ? '已启用' : '已停用'}</StatusBadge>
      </div>
      <p className="mt-[8px] line-clamp-1 wrap-break-word text-[12px] text-[#858b9c]">
        {row.method} · {row.url}
      </p>
    </article>
  );

  const listEmptyText = isOverallAgent ? '暂无工具，点击「新增」创建一个吧' : '当前员工暂无工具';

  return (
    <div className="min-h-full box-border px-[48px] pt-[32px] pb-[43px] max-[900px]:px-[16px]">
      <AppHeader onLogout={onLogout} userName={currentUser?.username} title={pageTitle} />

      <div className="mt-[20px] mb-[16px] flex items-center justify-end gap-[12px]">
        <UIButton
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="h-[34px] gap-[4px] rounded-[10px] border-[0.5px] border-[#e3e7f1] bg-white px-[20px] text-[12px] font-normal text-[#757f9c] hover:border-[#cbd3e6] hover:bg-white hover:text-[#18181a]"
        >
          <IconRefresh className={cn('size-[14px]', loading && 'animate-spin')} />
          刷新
        </UIButton>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-[34px] items-center gap-[4px] rounded-[10px] bg-[#18181a] px-[20px] text-[12px] font-normal text-white outline-none transition-colors hover:bg-[#303030]">
            <IconAdd className="size-[14px]" />
            新增
            <IconChevronDown className="size-[12px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={MENU_CONTENT_CLASS}>
            <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => handleCreateAction('blank')}>
              <IconAdd />
              新建空白工具
            </DropdownMenuItem>
            {!isOverallAgent && (
              <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => handleCreateAction('plaza')}>
                <IconTool className="size-[14px]" />
                从广场复制
              </DropdownMenuItem>
            )}
            {!isOverallAgent && (
              <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => handleCreateAction('employee')}>
                <FlaskConical />
                从数字员工复制
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex flex-col gap-[24px] rounded-[20px_20px_0_0] bg-white p-[18px_18px_24px_18px] shadow-[0_-4px_16px_0_rgba(0,0,0,0.05)]">
        <div className="flex flex-wrap items-stretch gap-[20px]" aria-label="工具统计">
          <StatCard label="工具总数" value={stats.total} className="basis-[220px]" />
          <StatCard label="已启用" value={stats.enabled} tone="green" className="basis-[220px]" />
          <StatCard label="分桶" value={stats.buckets} className="basis-[220px]" />
        </div>

        <div className="flex flex-col gap-[18px]">
          <div className="flex items-center gap-[6px] px-[12px] text-[#757f9c]">
            <IconTool className="size-[14px] shrink-0" />
            <span className="text-[14px] font-normal leading-none">{listLabel}</span>
          </div>

          <div className="flex flex-wrap items-center gap-[16px]">
            <label className="flex h-[34px] w-[300px] items-center gap-[8px] overflow-hidden rounded-[10px] border-[0.5px] border-[#e3e7f1] bg-white px-[12px] transition-colors focus-within:border-[#18181a] max-[900px]:w-full">
              <IconSearch className="size-[14px] shrink-0 text-[#858b9c]" />
              <input
                value={searchText}
                placeholder="搜索工具名称、描述、URL 或分桶"
                onChange={(event) => setSearchText(event.target.value)}
                className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-[#17191f] outline-none placeholder:text-[#c0c6d4]"
              />
              {searchText && (
                <button
                  type="button"
                  aria-label="清除搜索"
                  onClick={() => setSearchText('')}
                  className="grid size-[16px] shrink-0 place-items-center text-[#c0c6d4] hover:text-[#858b9c]"
                >
                  <IconClear className="size-[14px]" />
                </button>
              )}
            </label>
            <UISelect value={bucketFilter} onValueChange={setBucketFilter}>
              <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, 'w-[180px]')} aria-label="分桶筛选">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bucketSelectOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </UISelect>
          </div>

          <div className="grid gap-[10px] md:hidden">
            {filteredRows.length ? (
              pagination.pagedItems.map(renderMobileCard)
            ) : (
              <div className="py-[40px] text-center text-[13px] text-[#858b9c]">{listEmptyText}</div>
            )}
          </div>

          <div className="hidden md:block">
            <DataTable
              aria-label="工具列表"
              columns={columns}
              data={pagination.pagedItems}
              rowKey={(row) => row.id}
              loading={loading}
              emptyText={listEmptyText}
            />
          </div>

          {filteredRows.length > 0 && (
            <Paginator
              aria-label="工具分页"
              className="mt-0 mb-[6px]"
              page={pagination.page}
              pageCount={pagination.pageCount}
              onChange={pagination.setPage}
            />
          )}
        </div>
      </div>

      <ResourceImportDialog
        open={importOpen}
        loading={importLoading}
        icon={<IconTool className="size-[14px] shrink-0" />}
        title={importMode === 'plaza' ? '从广场复制工具' : '从数字员工复制工具'}
        targetLabel="复制到"
        targetPlaceholder="选择目标员工"
        targets={importTargetCandidates().map((item) => ({ value: item.id, label: item.name }))}
        targetId={importTargetAgentId}
        sourcePlaceholder={importMode === 'plaza' ? '选择工具广场' : '选择复制来源'}
        sources={agents
          .filter((item) => item.id !== importTargetAgentId && (importMode === 'plaza' ? item.is_overall : !item.is_overall))
          .map((item) => ({ value: item.id, label: item.is_overall ? '工具广场' : item.name }))}
        sourceId={importSourceAgentId}
        itemsLabel="选择工具"
        items={importSourceTools.map((item) => ({
          id: item.id,
          label: (
            <>
              {item.display_name || item.name}
              <span className="text-[#858b9c]"> · {item.name}</span>
            </>
          ),
        }))}
        selectedIds={importSelectedToolIds}
        emptyText="没有可复制的工具"
        note={
          importMode === 'plaza'
            ? '从广场复制可用工具；复制后会成为当前员工的本地工具绑定。'
            : '从数字员工复制可用工具；不可见内容不会出现在列表。'
        }
        onTargetChange={handleImportTargetChange}
        onSourceChange={(value) => {
          setImportSourceAgentId(value);
          void loadImportSourceTools(value);
        }}
        onSelectedChange={setImportSelectedToolIds}
        onClose={() => setImportOpen(false)}
        onSubmit={() => void submitImportTools()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        loading={deleting}
        title={deleteTarget ? `${isOverallAgent ? '删除' : '移除'}工具「${deleteTarget.display_name || deleteTarget.name}」？` : ''}
        description={
          isOverallAgent
            ? '删除后，引用该工具的技能将无法继续调用它，操作不可撤销。'
            : '从当前员工移除后，工具广场中的原始工具不会被删除。'
        }
        confirmText={isOverallAgent ? '删除' : '移除'}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

export function ToolNewPage(props: ToolPageProps = {}) {
  return <ToolEditorPage mode="new" {...props} />;
}

export function ToolEditPage(props: ToolPageProps = {}) {
  return <ToolEditorPage mode="edit" {...props} />;
}

function ToolEditorPage({ mode, currentUser, onLogout }: { mode: 'new' | 'edit' } & ToolPageProps) {
  const [values, setValues] = useState<ToolFormValues>({ ...TOOL_FORM_INITIAL_VALUES });
  const [tool, setTool] = useState<ToolRead | null>(null);
  const [loading, setLoading] = useState(false);
  const [bucketOptions, setBucketOptions] = useState<{ value: string; label: string }[]>([{ value: '未分桶', label: '未分桶' }]);
  const navigate = useNavigate();
  const { toolId } = useParams();
  const isEdit = mode === 'edit';

  const setField = <K extends keyof ToolFormValues>(name: K, value: ToolFormValues[K]) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  useEffect(() => {
    void loadBucketOptions().then(setBucketOptions);
  }, []);

  useEffect(() => {
    if (!isEdit) {
      setValues({ ...TOOL_FORM_INITIAL_VALUES });
      setTool(null);
      return;
    }
    if (!toolId) return;
    setLoading(true);
    const agentQuery = currentAgentQuery();
    api
      .get<ToolRead>(`/api/enterprise/tools/${toolId}?tenant_id=${TENANT_ID}${agentQuery}`)
      .then((row) => {
        setTool(row);
        setValues(toolToFormValues(row));
      })
      .catch((error) => notify.error(error instanceof Error ? error.message : '加载工具失败'))
      .finally(() => setLoading(false));
  }, [isEdit, toolId]);

  async function save() {
    if (!String(values.name || '').trim()) {
      notify.error('请填写工具名称');
      return;
    }
    if (!String(values.url || '').trim()) {
      notify.error(values.tool_type === 'mcp' ? '请填写 MCP URL 标记' : '请填写 URL');
      return;
    }
    if (values.tool_type === 'mcp' && !String(values.mcp_config || '').trim()) {
      notify.error('请填写 MCP Config JSON');
      return;
    }
    const payload = buildToolPayload(values);
    if (!payload) return;
    setLoading(true);
    try {
      const agentQuery = currentAgentQuery();
      const saved = isEdit && toolId
        ? await api.put<ToolRead>(`/api/enterprise/tools/${toolId}${agentQuery ? `?${agentQuery.slice(1)}` : ''}`, payload)
        : await api.post<ToolRead>(`/api/enterprise/tools${agentQuery ? `?${agentQuery.slice(1)}` : ''}`, payload);
      notify.success('已保存');
      setTool(saved);
      setValues(toolToFormValues(saved));
      if (!isEdit) {
        navigate(`/enterprise/tools/${saved.id}/edit`, { replace: true });
      }
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full box-border px-[48px] pt-[32px] pb-[43px] max-[900px]:px-[16px]" aria-busy={loading}>
      <AppHeader
        onLogout={onLogout}
        userName={currentUser?.username}
        title={isEdit ? '编辑工具' : '新建空白工具'}
        description={
          isEdit
            ? '修改工具定义，并在右侧验证当前配置或已保存版本。'
            : '填写工具定义后，可先用右侧探测区测试请求与返回结构。'
        }
      />
      <div className="mt-[20px] mb-[16px] flex flex-wrap justify-end gap-[16px]">
        <UIButton variant="outline" onClick={() => navigate('/enterprise/tools')} className={RETURN_BUTTON_CLASS}>
          <IconArrowRight className="size-3.5 rotate-180" />
          返回工具
        </UIButton>
        {isEdit && tool && (
          <UIButton
            variant="outline"
            onClick={() => navigate(`/enterprise/tools/${tool.id}/test`)}
            className={RETURN_BUTTON_CLASS}
          >
            <ExperimentOutlined />
            打开测试页
          </UIButton>
        )}
        <UIButton disabled={loading} onClick={() => void save()} className={PRIMARY_BUTTON_CLASS}>
          保存
        </UIButton>
      </div>
      <div className="grid grid-cols-1 items-start gap-[20px] xl:grid-cols-2">
        <SectionCard title="工具定义" loading={loading && isEdit && !tool}>
          <ToolFormFields values={values} setField={setField} bucketOptions={bucketOptions} />
        </SectionCard>
        <div className="flex w-full flex-col gap-[20px]">
          <ToolProbeCard values={values} />
          {isEdit && tool && <SavedToolTestCard tool={tool} />}
        </div>
      </div>
    </div>
  );
}

const CARD_CLASS =
  'rounded-[14px] border border-[#eceef1] bg-white';
const CARD_TITLE_CLASS = 'text-[14px] font-medium text-[#18181a]';
const FIELD_LABEL_CLASS = 'text-[13px] font-medium text-[#18181a]';
const SUBSECTION_TITLE_CLASS = 'text-[13px] font-medium text-[#18181a]';
const HINT_CLASS = 'text-[12px] leading-[1.55] text-[#858b9c]';
const MONO_INPUT_CLASS = 'font-mono text-[12px] leading-[1.65]';
const RETURN_BUTTON_CLASS =
  'h-8 gap-1 rounded-[10px] border-[0.5px] border-[#e3e7f1] bg-white px-5 text-[12px] font-normal text-[#757f9c] hover:border-[#cbd3e6] hover:bg-white hover:text-[#18181a]';
const PRIMARY_BUTTON_CLASS =
  'h-8 gap-1 rounded-[10px] bg-[#18181a] px-5 text-[12px] font-normal text-white hover:bg-[#303030]';

function SectionCard({
  title,
  extra,
  loading,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn(CARD_CLASS, 'overflow-hidden', className)}>
      {(title || extra) && (
        <div className="flex min-h-[54px] items-center justify-between gap-[12px] border-b border-[#eceef1] px-[20px] py-[10px]">
          <div className={cn('min-w-0', CARD_TITLE_CLASS)}>{title}</div>
          {extra ? <div className="shrink-0">{extra}</div> : null}
        </div>
      )}
      <div className={cn('p-[20px]', bodyClassName)}>
        {loading ? (
          <div className="py-[24px] text-center text-[13px] text-[#858b9c]">加载中…</div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={htmlFor} className={FIELD_LABEL_CLASS}>
        {label}
      </label>
      {children}
      {hint ? <span className={HINT_CLASS}>{hint}</span> : null}
    </div>
  );
}

export function ToolTestPage({ currentUser, onLogout }: ToolPageProps = {}) {
  const [tool, setTool] = useState<ToolRead | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toolId } = useParams();

  useEffect(() => {
    if (!toolId) return;
    setLoading(true);
    const agentQuery = currentAgentQuery();
    api
      .get<ToolRead>(`/api/enterprise/tools/${toolId}?tenant_id=${TENANT_ID}${agentQuery}`)
      .then(setTool)
      .catch((error) => notify.error(error instanceof Error ? error.message : '加载工具失败'))
      .finally(() => setLoading(false));
  }, [toolId]);

  return (
    <div className="min-h-full box-border px-[48px] pt-[32px] pb-[43px] max-[900px]:px-[16px]" aria-busy={loading}>
      <AppHeader
        onLogout={onLogout}
        userName={currentUser?.username}
        title="工具测试"
        description="用测试参数直接调用已保存工具，检查员工后续调用时的实际返回。"
      />
      <div className="mt-[20px] mb-[16px] flex flex-wrap justify-end gap-[16px]">
        <UIButton variant="outline" onClick={() => navigate('/enterprise/tools')} className={RETURN_BUTTON_CLASS}>
          <IconArrowRight className="size-3.5 rotate-180" />
          返回工具
        </UIButton>
        {tool && (
          <UIButton
            variant="outline"
            onClick={() => navigate(`/enterprise/tools/${tool.id}/edit`)}
            className={RETURN_BUTTON_CLASS}
          >
            <IconEdit className="size-3.5" />
            编辑工具
          </UIButton>
        )}
      </div>
      <div className="grid grid-cols-1 items-start gap-[20px] xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <SectionCard title="工具信息" loading={loading && !tool} bodyClassName="flex flex-col gap-[16px]">
          {tool && (
            <>
              <div className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-[16px] rounded-[14px] border border-[#eceef1] bg-[#fafbfc] p-[16px]">
                <div className="grid size-[58px] place-items-center rounded-[16px] border border-[#eceef1] bg-white text-[24px] text-[#18181a]">
                  <ToolOutlined />
                </div>
                <div className="min-w-0">
                  <span className="text-[12px] font-semibold text-[#1a71ff]">{tool.bucket || '未分桶'}</span>
                  <h4 className="my-[4px] text-[18px] font-semibold wrap-break-word text-[#18181a]">
                    {tool.display_name || tool.name}
                  </h4>
                  <p className="mb-[10px] text-[13px] leading-[1.65] wrap-break-word text-[#858b9c]">
                    {tool.description || '暂无描述'}
                  </p>
                  <div className="flex flex-wrap items-center gap-[6px]">
                    <StatusBadge tone={tool.tool_type === 'mcp' ? 'blue' : 'gray'}>{toolTypeLabel(tool)}</StatusBadge>
                    <StatusBadge tone={tool.enabled ? 'green' : 'gray'}>{tool.enabled ? '已启用' : '已停用'}</StatusBadge>
                    <StatusBadge tone="gray">{tool.method}</StatusBadge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-[10px] md:grid-cols-4">
                {[
                  { label: '工具 ID', value: tool.name },
                  { label: '输入字段', value: schemaPropertyCount(tool.input_schema) },
                  { label: '输出字段', value: schemaPropertyCount(tool.output_schema) },
                  { label: '最近更新', value: formatDateTime(tool.updated_at) },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex min-h-[78px] flex-col gap-[8px] rounded-[12px] border border-[#eceef1] bg-white px-[14px] py-[13px]"
                  >
                    <span className="text-[12px] font-semibold text-[#858b9c]">{item.label}</span>
                    <strong className="text-[14px] leading-[1.35] wrap-break-word text-[#18181a]">
                      {item.value}
                    </strong>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-[8px] rounded-[12px] border border-[#eceef1] bg-[#fafbfc] px-[16px] py-[14px]">
                <span className="text-[12px] font-semibold text-[#858b9c]">调用地址</span>
                <code className="block font-mono text-[13px] leading-[1.6] wrap-break-word text-[#18181a]">
                  {tool.method} {tool.url}
                </code>
              </div>

              <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
                <div className="flex flex-col gap-[10px]">
                  <span className={SUBSECTION_TITLE_CLASS}>Input Schema</span>
                  <CodeBlock className="max-h-[340px] whitespace-pre-wrap wrap-break-word" code={formatJson(tool.input_schema)} language="json" />
                </div>
                <div className="flex flex-col gap-[10px]">
                  <span className={SUBSECTION_TITLE_CLASS}>Output Schema</span>
                  <CodeBlock className="max-h-[340px] whitespace-pre-wrap wrap-break-word" code={formatJson(tool.output_schema)} language="json" />
                </div>
              </div>
            </>
          )}
        </SectionCard>
        {tool && <SavedToolTestCard tool={tool} standalone />}
      </div>
    </div>
  );
}

function ToolFormFields({
  values,
  setField,
  bucketOptions,
}: {
  values: ToolFormValues;
  setField: <K extends keyof ToolFormValues>(name: K, value: ToolFormValues[K]) => void;
  bucketOptions: { value: string; label: string }[];
}) {
  const toolType = values.tool_type || 'http';
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
        <Field label="工具名称" htmlFor="tool-name">
          <div className="relative">
            <ToolOutlined className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-[#858b9c]" />
            <Input
              id="tool-name"
              className="pl-[30px]"
              placeholder="order_query"
              value={values.name || ''}
              onChange={(event) => setField('name', event.target.value)}
            />
          </div>
        </Field>
        <Field label="展示名称" htmlFor="tool-display-name">
          <Input
            id="tool-display-name"
            placeholder="订单查询"
            value={values.display_name || ''}
            onChange={(event) => setField('display_name', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
        <Field label="工具类型">
          <UISelect value={toolType} onValueChange={(value) => setField('tool_type', value)}>
            <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, 'w-full')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP 接口</SelectItem>
              <SelectItem value="mcp">MCP 服务</SelectItem>
            </SelectContent>
          </UISelect>
        </Field>
        <Field label="工具分桶" htmlFor="tool-bucket">
          <Input
            id="tool-bucket"
            list="tool-bucket-options"
            placeholder="选择或输入分桶"
            value={values.bucket || ''}
            onChange={(event) => setField('bucket', event.target.value)}
          />
          <datalist id="tool-bucket-options">
            {bucketOptions.map((item) => (
              <option key={item.value} value={item.value} />
            ))}
          </datalist>
        </Field>
      </div>

      <Field label="描述" htmlFor="tool-description">
        <Textarea
          id="tool-description"
          rows={2}
          placeholder="简单说明这个工具的用途"
          value={values.description || ''}
          onChange={(event) => setField('description', event.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-[140px_minmax(0,1fr)]">
        <Field label={toolType === 'mcp' ? 'Method 标记' : 'HTTP Method'}>
          <UISelect value={values.method} onValueChange={(value) => setField('method', value)}>
            <SelectTrigger className={cn(SELECT_TRIGGER_CLASS, 'w-full')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => (
                <SelectItem key={value} value={value}>{value}</SelectItem>
              ))}
            </SelectContent>
          </UISelect>
        </Field>
        <Field label={toolType === 'mcp' ? 'MCP URL 标记' : 'URL'} htmlFor="tool-url">
          <Input
            id="tool-url"
            placeholder={toolType === 'mcp' ? 'mcp://builtin.demo/echo' : '/api/mock/order/query'}
            value={values.url || ''}
            onChange={(event) => setField('url', event.target.value)}
          />
        </Field>
      </div>

      {toolType === 'mcp' ? (
        <Field label="MCP Config JSON" htmlFor="tool-mcp-config">
          <Textarea
            id="tool-mcp-config"
            rows={4}
            className={MONO_INPUT_CLASS}
            placeholder={'{\n  "server": "builtin.demo",\n  "tool": "echo"\n}'}
            value={values.mcp_config}
            onChange={(event) => setField('mcp_config', event.target.value)}
          />
        </Field>
      ) : (
        <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
          <Field label="Headers JSON" htmlFor="tool-headers">
            <Textarea
              id="tool-headers"
              rows={4}
              className={MONO_INPUT_CLASS}
              value={values.headers}
              onChange={(event) => setField('headers', event.target.value)}
            />
          </Field>
          <Field label="Auth JSON" htmlFor="tool-auth">
            <Textarea
              id="tool-auth"
              rows={4}
              className={MONO_INPUT_CLASS}
              value={values.auth}
              onChange={(event) => setField('auth', event.target.value)}
            />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2">
        <Field label="Input Schema" htmlFor="tool-input-schema">
          <Textarea
            id="tool-input-schema"
            rows={5}
            className={MONO_INPUT_CLASS}
            value={values.input_schema}
            onChange={(event) => setField('input_schema', event.target.value)}
          />
        </Field>
        <Field label="Output Schema" htmlFor="tool-output-schema">
          <Textarea
            id="tool-output-schema"
            rows={5}
            className={MONO_INPUT_CLASS}
            value={values.output_schema}
            onChange={(event) => setField('output_schema', event.target.value)}
          />
        </Field>
      </div>

      <Field label="Allowed Skills" htmlFor="tool-allowed-skills" hint="留空表示所有技能可调用，多个技能用英文逗号分隔。">
        <Input
          id="tool-allowed-skills"
          placeholder="skill_id_1,skill_id_2"
          value={values.allowed_skills || ''}
          onChange={(event) => setField('allowed_skills', event.target.value)}
        />
      </Field>

      <div className="flex items-center justify-between rounded-[12px] border border-[#eceef1] bg-[#fafbfc] px-[14px] py-[12px]">
        <div className="flex flex-col gap-[2px]">
          <span className={FIELD_LABEL_CLASS}>启用工具</span>
          <span className={HINT_CLASS}>停用后员工将无法调用该工具。</span>
        </div>
        <Switch checked={values.enabled} onCheckedChange={(next) => setField('enabled', next)} />
      </div>
    </div>
  );
}

function ToolProbeCard({ values }: { values: ToolFormValues }) {
  const [sampleJson, setSampleJson] = useState('{}');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const method = values.method || 'POST';
  const isGetMethod = method === 'GET';

  async function probe() {
    if (!String(values.name || '').trim()) {
      notify.error('请填写工具名称');
      return;
    }
    if (!String(values.url || '').trim()) {
      notify.error(values.tool_type === 'mcp' ? '请填写 MCP URL 标记' : '请填写 URL');
      return;
    }
    const payload = buildToolPayload(values);
    if (!payload) return;
    let sampleArguments: Record<string, unknown>;
    try {
      sampleArguments = parseJson(sampleJson, {});
    } catch {
      notify.error('测试参数不是合法 JSON');
      return;
    }
    if (
      payload.tool_type === 'http'
      && payload.method !== 'GET'
      && payload.url.includes('?')
      && Object.keys(sampleArguments).length === 0
    ) {
      notify.error('URL 已包含查询参数时请把 HTTP Method 切换为 GET；POST 会把测试参数作为 JSON Body 发送。');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post('/api/enterprise/tools/probe', {
        tenant_id: TENANT_ID,
        name: payload.name,
        display_name: payload.display_name,
        description: payload.description,
        bucket: payload.bucket,
        tool_type: payload.tool_type,
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        auth: payload.auth,
        mcp_config: payload.mcp_config,
        input_schema: payload.input_schema,
        output_schema: payload.output_schema,
        sample_arguments: sampleArguments,
      });
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '探测失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard
      title="配置探测"
      bodyClassName="flex flex-col gap-[14px]"
      extra={(
        <UIButton variant="outline" disabled={loading} onClick={() => void probe()} className={RETURN_BUTTON_CLASS}>
          <ExperimentOutlined />
          探测
        </UIButton>
      )}
    >
      <p className={HINT_CLASS}>无需保存，直接用当前配置测试连接。</p>
      <div className="flex flex-col gap-[8px]">
        <span className={SUBSECTION_TITLE_CLASS}>
          {isGetMethod ? '测试参数 JSON（拼到 URL Query）' : '测试参数 JSON（作为请求 Body）'}
        </span>
        <p className={HINT_CLASS}>
          {isGetMethod
            ? 'GET 会把这里的字段作为查询参数追加到 URL；参数值填写未编码原文，例如 timezone 用 Asia/Shanghai。'
            : '非 GET 请求会把这里的 JSON 作为请求体发送；仅 URL 查询串不会变成请求 Body。'}
        </p>
        <Textarea
          rows={5}
          className={MONO_INPUT_CLASS}
          value={sampleJson}
          onChange={(event) => setSampleJson(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-[8px]">
        <span className={SUBSECTION_TITLE_CLASS}>探测结果</span>
        <Textarea rows={8} readOnly className={MONO_INPUT_CLASS} value={result} />
      </div>
    </SectionCard>
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
      notify.error('测试参数不是合法 JSON');
      return;
    }
    setLoading(true);
    try {
      const agentQuery = currentAgentQuery();
      const response = await api.post(`/api/enterprise/tools/${tool.id}/test${agentQuery ? `?${agentQuery.slice(1)}` : ''}`, {
        tenant_id: TENANT_ID,
        arguments: argumentsJson,
      });
      setTestResult(JSON.stringify(response, null, 2));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '调用失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard
      className={standalone ? undefined : 'xl:sticky xl:top-[18px]'}
      bodyClassName="flex flex-col gap-[16px]"
      title={(
        <span className="inline-flex items-center gap-[8px]">
          <ExperimentOutlined />
          {standalone ? '调用测试' : '已保存工具测试'}
        </span>
      )}
      extra={(
        <UIButton disabled={loading} onClick={() => void test()} className={PRIMARY_BUTTON_CLASS}>
          <ExperimentOutlined />
          调用
        </UIButton>
      )}
    >
      <div className="flex items-start justify-between gap-[12px] rounded-[12px] border border-[#eceef1] bg-[#fafbfc] px-[14px] py-[12px]">
        <span className="text-[13px] leading-[1.65] text-[#858b9c]">
          调用已保存的「{tool.display_name || tool.name}」，用于验证员工实际可用的工具返回。
        </span>
        <StatusBadge tone="gray">{toolTypeLabel(tool)}</StatusBadge>
      </div>
      <div className="flex flex-col gap-[10px]">
        <span className={SUBSECTION_TITLE_CLASS}>测试参数</span>
        <Textarea
          rows={8}
          className={MONO_INPUT_CLASS}
          value={testJson}
          onChange={(event) => setTestJson(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-[10px]">
        <div className="flex items-center justify-between gap-[10px]">
          <span className={SUBSECTION_TITLE_CLASS}>调用结果</span>
          <StatusBadge tone={testResult ? 'green' : 'gray'}>{testResult ? '已返回' : '等待调用'}</StatusBadge>
        </div>
        {testResult ? (
          <CodeBlock className="max-h-[340px] whitespace-pre-wrap wrap-break-word" code={testResult} language="json" />
        ) : (
          <div className="grid min-h-[180px] place-items-center rounded-[12px] border border-dashed border-[#eceef1] p-[20px] text-center text-[13px] text-[#858b9c]">
            点击调用后，这里会显示工具返回、错误信息和原始 data。
          </div>
        )}
      </div>
    </SectionCard>
  );
}

async function loadBucketOptions() {
  const rows = await api.get<ToolRead[]>(`/api/enterprise/tools?tenant_id=${TENANT_ID}${currentAgentQuery()}`);
  return Array.from(new Set(['未分桶', ...rows.map((row) => row.bucket || '未分桶')]))
    .map((value) => ({ value, label: value }));
}

function currentAgentQuery() {
  const agentId = window.localStorage.getItem(ENTERPRISE_AGENT_STORAGE_KEY) || '';
  return agentId ? `&agent_id=${encodeURIComponent(agentId)}` : '';
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
      url: String(values.url || '').trim(),
      headers: parseJson(values.headers, {}),
      auth: parseJson(values.auth, {}),
      mcp_config: values.tool_type === 'mcp' ? parseJson(values.mcp_config, {}) : {},
      input_schema: parseJson(values.input_schema, {}),
      output_schema: parseJson(values.output_schema, {}),
      allowed_skills: String(values.allowed_skills || '').split(',').map((item) => item.trim()).filter(Boolean),
      enabled: values.enabled,
    };
  } catch {
    notify.error('JSON 配置格式不正确，请检查 Headers、Auth、Schema 或 MCP Config');
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
  return tool.tool_type === 'mcp' ? 'MCP 服务' : 'HTTP 接口';
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
