/** 图标：统一使用 lucide-react（16px、1.5 线宽、currentColor）。保留按名称取图标的旧接口，页面无需改动。 */
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bell, BookOpen, ChartColumn, Check, ChevronRight, CircleCheck,
  Coins, Command, Cpu, Ellipsis, ExternalLink, FileCode2, Flame, Inbox, Info, Kanban, Lightbulb, LayoutList, ListChecks, Menu, Monitor, Moon,
  PanelLeft, PenLine, Plus, Puzzle, RefreshCw, Search, Send, Settings, Shield, Sparkles, Sun, Upload, WifiOff, X, CalendarCheck, KeyRound, DatabaseBackup, SlidersHorizontal, Eye, Smartphone,
  type LucideIcon,
} from 'lucide-react';

const MAP: Record<string, LucideIcon> = {
  today: CalendarCheck, inspire: Lightbulb, create: PenLine, analytics: ChartColumn, settings: Settings,
  overview: CalendarCheck, hot: Flame, library: BookOpen, topics: Sparkles, review: CircleCheck, creator: Monitor, agent: FileCode2,
  improve: RefreshCw, plugins: Puzzle, tasks: ListChecks, menu: Menu, close: X, sun: Sun, moon: Moon, search: Search, bell: Bell,
  arrowRight: ArrowRight, arrowLeft: ArrowLeft, arrowUp: ArrowUpRight, arrowDown: ArrowDownRight, chevronRight: ChevronRight, sidebar: PanelLeft,
  more: Ellipsis, wifiOff: WifiOff, shield: Shield, cpu: Cpu, coin: Coins, activity: Activity, inbox: Inbox, command: Command, check: Check,
  alert: AlertTriangle, info: Info, plus: Plus, kanban: Kanban, list: LayoutList, send: Send, external: ExternalLink, upload: Upload,
  key: KeyRound, backup: DatabaseBackup, sliders: SlidersHorizontal, eye: Eye, phone: Smartphone,
};

export type IconName = keyof typeof MAP;

export function Icon({ name, size = 16, className, strokeWidth = 1.5 }: { name: IconName | string; size?: number; className?: string; strokeWidth?: number }) {
  const C = MAP[name] ?? CalendarCheck;
  return <C className={`icon ${className ?? ''}`} size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" />;
}
