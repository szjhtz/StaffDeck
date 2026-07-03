import { CheckOutlined, UploadOutlined } from '../icons';
import { Button, Modal, Typography, message } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { api, TENANT_ID } from '../api/client';
import {
  EMPLOYEE_AVATAR_PRESETS,
  employeeDisplayName,
  employeeProfile,
  type EmployeeProfile,
} from '../employee';
import type { AgentProfileRead } from '../types';
import EmployeeAvatar from './EmployeeAvatar';

const MAX_INPUT_IMAGE_BYTES = 5 * 1024 * 1024;
const AVATAR_CANVAS_SIZE = 360;

type AvatarDraft = Pick<EmployeeProfile, 'avatarKind' | 'avatarImage' | 'avatarPreset' | 'avatarText' | 'avatarTone'>;

export default function EmployeeAvatarEditor({
  agent,
  open,
  onClose,
  onSaved,
}: {
  agent?: AgentProfileRead | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (agent: AgentProfileRead) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<'preset' | 'upload'>('preset');
  const [selectedPreset, setSelectedPreset] = useState(EMPLOYEE_AVATAR_PRESETS[0].key);
  const [uploadedImage, setUploadedImage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !agent) return;
    const profile = employeeProfile(agent);
    setMode(profile.avatarKind);
    setSelectedPreset(profile.avatarPreset || EMPLOYEE_AVATAR_PRESETS[0].key);
    setUploadedImage(profile.avatarImage || '');
  }, [agent, open]);

  const selected = EMPLOYEE_AVATAR_PRESETS.find((item) => item.key === selectedPreset) || EMPLOYEE_AVATAR_PRESETS[0];
  const profile: AvatarDraft = mode === 'upload' && uploadedImage
    ? {
      avatarKind: 'upload',
      avatarImage: uploadedImage,
      avatarPreset: selected.key,
      avatarText: selected.text,
      avatarTone: selected.tone,
    }
    : {
      avatarKind: 'preset',
      avatarImage: '',
      avatarPreset: selected.key,
      avatarText: selected.text,
      avatarTone: selected.tone,
    };

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setUploadedImage(dataUrl);
      setMode('upload');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '头像读取失败');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function save() {
    if (!agent) return;
    setSaving(true);
    try {
      const metadata = { ...(agent.metadata || {}) };
      metadata.avatar_kind = profile.avatarKind;
      metadata.avatar_preset = profile.avatarPreset;
      metadata.avatar_text = profile.avatarText;
      metadata.avatar_tone = profile.avatarTone;
      if (profile.avatarKind === 'upload' && profile.avatarImage) {
        metadata.avatar_image = profile.avatarImage;
      } else {
        delete metadata.avatar_image;
      }

      const saved = await api.put<AgentProfileRead>(`/api/enterprise/agents/${agent.id}`, {
        tenant_id: TENANT_ID,
        metadata,
      });
      message.success('员工头像已更新');
      onSaved?.(saved);
      onClose();
      window.dispatchEvent(new Event('ultrarag-enterprise-agent-scope-refresh'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存头像失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      className="employee-avatar-modal"
      title={agent ? `设置头像：${employeeDisplayName(agent)}` : '设置头像'}
      open={open}
      onCancel={onClose}
      onOk={() => void save()}
      okText="保存头像"
      cancelText="取消"
      confirmLoading={saving}
      width={680}
      destroyOnClose
    >
      <div className="employee-avatar-editor">
        <div className="employee-avatar-preview">
          <EmployeeAvatar profile={profile} size={104} />
          <div>
            <Typography.Text strong>{mode === 'upload' ? '自定义头像' : selected.label}</Typography.Text>
            <Typography.Paragraph type="secondary">
              头像会显示在我的数字员工、数字员工档案页和对话端的员工选择中。
            </Typography.Paragraph>
          </div>
        </div>

        <div className="employee-avatar-section">
          <div className="employee-avatar-section-head">
            <Typography.Text strong>默认头像</Typography.Text>
            <Typography.Text type="secondary">选择一个适合岗位的默认头像。</Typography.Text>
          </div>
          <div className="employee-avatar-preset-grid">
            {EMPLOYEE_AVATAR_PRESETS.map((preset) => {
              const active = mode === 'preset' && selectedPreset === preset.key;
              return (
                <button
                  key={preset.key}
                  type="button"
                  className={`employee-avatar-preset-card ${active ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedPreset(preset.key);
                    setMode('preset');
                  }}
                >
                  <EmployeeAvatar
                    profile={{
                      avatarKind: 'preset',
                      avatarImage: '',
                      avatarPreset: preset.key,
                      avatarText: preset.text,
                      avatarTone: preset.tone,
                    }}
                    size={52}
                  />
                  <span>{preset.label}</span>
                  {active && <CheckOutlined />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="employee-avatar-upload">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
          <Button icon={<UploadOutlined />} onClick={() => inputRef.current?.click()}>
            上传自定义头像
          </Button>
          <Typography.Text type="secondary">支持常见图片格式，会自动裁剪为方形头像。</Typography.Text>
        </div>
      </div>
    </Modal>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('头像读取失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onerror = () => reject(new Error('无法解析头像图片'));
    image.onload = () => resolve(image);
    image.src = dataUrl;
  });
}

async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  if (file.size > MAX_INPUT_IMAGE_BYTES) {
    throw new Error('头像图片不能超过 5MB');
  }

  const image = await loadImage(await readFileAsDataUrl(file));
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理头像图片');

  const side = Math.min(image.width, image.height);
  const sx = Math.max(0, (image.width - side) / 2);
  const sy = Math.max(0, (image.height - side) / 2);
  context.fillStyle = '#f7f4ee';
  context.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
  context.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);

  const png = canvas.toDataURL('image/png');
  return png.length < 650_000 ? png : canvas.toDataURL('image/jpeg', 0.86);
}
