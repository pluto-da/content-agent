import { getModels, type ModelsState } from './store';
import { useStoreValue } from './useStore';

/**
 * 0.8.1：常驻组件（Agent 面板、模型胶囊、首页）读取模型配置的唯一入口。
 * 挂载时读一次；之后在模型配置被写入（kv:models）、路由切换、窗口回到前台时重新读取，
 * 所以在“我的→模型”里保存后不用刷新页面。
 */
export function useModels(): [ModelsState | null, () => void] {
  const { value, reload } = useStoreValue(getModels, ['kv:models'], { onNavigate: true });
  return [value ?? null, reload];
}
