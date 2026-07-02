import type { AgentProfileRead, AgentResourceType } from './types';
import type { AuthUser } from './api/client';

export type EmployeeProfile = {
  roleKey: string;
  roleName: string;
  avatarText: string;
  avatarTone: string;
  avatarKind: 'preset' | 'upload';
  avatarPreset: string;
  avatarImage: string;
  workStyles: string[];
  expertiseTags: string[];
  workModes: string[];
};

const AVATAR_PRESETS: Record<string, { text: string; tone: string }> = {
  'service-orbit': { text: '研', tone: 'teal' },
  'after-sales-seal': { text: '行', tone: 'copper' },
  'knowledge-node': { text: '知', tone: 'olive' },
  'commerce-compass': { text: '财', tone: 'blue' },
  'ops-grid': { text: '人', tone: 'ink' },
  'quality-star': { text: '法', tone: 'gold' },
};

const EMPLOYEE_TEMPLATES: Record<string, {
  roleName: string;
  avatarText: string;
  avatarTone: string;
  avatarPreset: string;
  workStyles: string[];
  expertiseTags: string[];
  workModes: string[];
}> = {
  'service-specialist': {
    roleName: '研发',
    avatarText: '研',
    avatarTone: 'teal',
    avatarPreset: 'service-orbit',
    workStyles: ['目标明确', '证据优先', '动作可追溯'],
    expertiseTags: ['研发协作', '代码检索', 'SOP 执行'],
    workModes: ['理解需求', '检索资料', '推进执行'],
  },
  'after-sales': {
    roleName: '行政',
    avatarText: '行',
    avatarTone: 'copper',
    avatarPreset: 'after-sales-seal',
    workStyles: ['流程推进', '及时追问', '留痕复盘'],
    expertiseTags: ['资料归档', '会议纪要', '事务跟进'],
    workModes: ['确认事项', '拆解步骤', '同步结果'],
  },
  'knowledge-operator': {
    roleName: '知识运营',
    avatarText: '知',
    avatarTone: 'olive',
    avatarPreset: 'knowledge-node',
    workStyles: ['证据优先', '结构清晰', '持续沉淀'],
    expertiseTags: ['知识检索', '资料归档', '信息结构化'],
    workModes: ['查资料', '做归档', '给答案'],
  },
  'commerce-guide': {
    roleName: '财务',
    avatarText: '财',
    avatarTone: 'blue',
    avatarPreset: 'commerce-compass',
    workStyles: ['证据优先', '口径统一', '风险克制'],
    expertiseTags: ['报销核对', '预算口径', '数据复盘'],
    workModes: ['查规则', '核凭证', '给结论'],
  },
};

const DEFAULT_WORK_STYLES = ['目标明确', '证据优先', '动作可追溯'];
const DEFAULT_EXPERTISE = ['业务问答', 'SOP 执行', '工具调用'];
const DEFAULT_WORK_MODES = ['识别意图', '补齐信息', '执行并复盘'];

const SD1_TEXT_REPLACEMENTS: Array<[RegExp, string]> = [
  [/默认员工/g, '研发员工'],
  [/在线客服员工/g, '研发员工'],
  [/在线客服/g, '研发'],
  [/客服接待/g, '研发协作'],
  [/运营排查/g, '人事'],
  [/质量复盘/g, '法务'],
  [/客服分支/g, '研发分支'],
  [/智能客服/g, '数字员工'],
  [/客服/g, '员工'],
  [/售后退款流程/g, '行政资料复盘流程'],
  [/售后换货流程/g, '行政事务跟进流程'],
  [/售后处理/g, '行政处理'],
  [/售后/g, '行政'],
  [/商品比价服务/g, '财务数据核对'],
  [/商品比价/g, '财务核对'],
  [/商品导购/g, '财务分析'],
  [/商品/g, '资料'],
  [/订单/g, '任务单'],
  [/退款/g, '报销'],
  [/换货/g, '归档'],
  [/购买/g, '执行'],
];

export function staffdeckDisplayText(value: string): string {
  return SD1_TEXT_REPLACEMENTS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

function staffdeckRoleName(value: string): string {
  return staffdeckDisplayText(value);
}

function stringFromMeta(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function arrayFromMeta(metadata: Record<string, unknown> | undefined, key: string): string[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export function employeeProfile(agent?: AgentProfileRead | null): EmployeeProfile {
  if (agent?.is_overall) {
    return {
      roleKey: 'overall',
      roleName: '开放广场',
      avatarText: '广',
      avatarTone: 'overall',
      avatarKind: 'preset',
      avatarPreset: 'overall',
      avatarImage: '',
      workStyles: [],
      expertiseTags: [],
      workModes: [],
    };
  }
  const metadata = agent?.metadata || {};
  const isBlankOnboarding = metadata.blank_onboarding === true;
  const roleKey = stringFromMeta(metadata, 'role_key');
  const templateKey = isBlankOnboarding ? '' : roleKey || 'service-specialist';
  const template = templateKey ? EMPLOYEE_TEMPLATES[templateKey] || EMPLOYEE_TEMPLATES['service-specialist'] : undefined;
  const presetKey = stringFromMeta(metadata, 'avatar_preset') || template?.avatarPreset || 'service-orbit';
  const preset = AVATAR_PRESETS[presetKey] || AVATAR_PRESETS['service-orbit'];
  const avatarImage = stringFromMeta(metadata, 'avatar_image');
  const avatarKind = stringFromMeta(metadata, 'avatar_kind') === 'upload' && avatarImage ? 'upload' : 'preset';
  const workStyles = arrayFromMeta(metadata, 'work_styles');
  const expertiseTags = arrayFromMeta(metadata, 'expertise_tags');
  const workModes = arrayFromMeta(metadata, 'work_modes');
  return {
    roleKey: roleKey || (template ? templateKey : ''),
    roleName: staffdeckRoleName(stringFromMeta(metadata, 'role_name') || template?.roleName || '待补充岗位'),
    avatarText: stringFromMeta(metadata, 'avatar_text') || preset.text || template?.avatarText || '员',
    avatarTone: stringFromMeta(metadata, 'avatar_tone') || preset.tone || template?.avatarTone || 'teal',
    avatarKind,
    avatarPreset: presetKey,
    avatarImage,
    workStyles: workStyles.length ? workStyles : isBlankOnboarding ? [] : DEFAULT_WORK_STYLES,
    expertiseTags: expertiseTags.length ? expertiseTags : isBlankOnboarding ? [] : DEFAULT_EXPERTISE,
    workModes: workModes.length ? workModes : isBlankOnboarding ? [] : DEFAULT_WORK_MODES,
  };
}

export function employeeDisplayName(agent?: AgentProfileRead | null): string {
  if (!agent) return '数字员工';
  if (agent.is_overall) return '开放广场';
  return staffdeckDisplayText((agent.name || '数字员工').replace(/智能体/g, '员工'));
}

export function isGalleryEmployee(agent?: AgentProfileRead | null): boolean {
  return agent?.metadata?.published_to_gallery === true;
}

export function isEmployeeOwnedBy(agent: AgentProfileRead, user?: AuthUser | null): boolean {
  if (!user) return false;
  const ownerUserId = agent.metadata?.owner_user_id;
  const ownerUsername = agent.metadata?.owner_username;
  return ownerUserId === user.id || ownerUsername === user.username;
}

export function visibleChatEmployees(rows: AgentProfileRead[], user?: AuthUser | null): AgentProfileRead[] {
  return rows.filter((agent) => !agent.is_overall && agent.status === 'active');
}

export function agentResourceCount(agent: AgentProfileRead, resourceType: AgentResourceType): number {
  return (agent.resources || []).filter((resource) => (
    resource.resource_type === resourceType
    && resource.status !== 'deleted'
    && resource.status !== 'inactive'
  )).length;
}
