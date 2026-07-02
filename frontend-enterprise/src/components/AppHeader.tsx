import type { ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui';
import { cn } from '@/lib/utils';

import IconChevronDown from '../assets/icons/chevron-down.svg?react';
import IconLogout from '../assets/icons/logout.svg?react';
import StaffdeckIcon from './StaffdeckIcon';

export type AppHeaderProps = {
  /** Page-specific content rendered on the left side of the header. */
  left?: ReactNode;
  /**
   * Custom content for the right side of the header. When provided it fully
   * replaces the default user avatar / logout dropdown (used e.g. on the
   * signed-out login page which shows a theme toggle + login button instead).
   */
  right?: ReactNode;
  /** Called when the logout menu item is clicked. */
  onLogout?: () => void;
  /** Current user's display name, used for the avatar initial. */
  userName?: string;
  className?: string;
};

/**
 * Global page header. The right side shows a user avatar button whose dropdown
 * holds the logout action; the left side is provided per-page via the `left` slot.
 * Pass `right` to override the default avatar with page-specific actions.
 */
export default function AppHeader({ left, right, onLogout, userName, className }: AppHeaderProps) {
  const initial = userName?.trim()?.[0]?.toUpperCase();

  return (
    <header className={cn('flex w-full gap-[16px]', className)}>
      <div className="min-w-0 flex-1">{left}</div>
      <div className="flex shrink-0 items-start gap-[8px]">
        {right !== undefined ? right : (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="账户菜单"
            className="flex shrink-0 items-center gap-[10px] rounded-[10px] py-[4px] pl-[6px] pr-[10px] outline-none mt-[4px]"
          >
            <span className="grid size-[32px] shrink-0 place-items-center overflow-hidden rounded-full bg-[#eef1fb] text-[14px] font-medium text-[#7e96dc] dark:bg-white/10">
              {initial ?? <StaffdeckIcon name="user" size={18} />}
            </span>
            <IconChevronDown className="size-[14px] shrink-0 text-[#757F9C]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-fit min-w-0 rounded-[14px] border-0 bg-white p-[6px] shadow-[0px_16px_15px_rgba(0,0,0,0.1)] ring-0 dark:bg-[#26272d] [--accent:#F6F6F6] [--accent-foreground:#18181A] dark:[--accent:#2f3136] dark:[--accent-foreground:#ffffff]"
          >
            <DropdownMenuItem
              onSelect={() => onLogout?.()}
              className="h-[36px] cursor-pointer gap-2 rounded-[10px] px-[12px] text-[14px] text-[#464C5E] dark:text-[#a8afbd]"
            >
              <IconLogout className="size-[16px]" />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </div>
    </header>
  );
}
