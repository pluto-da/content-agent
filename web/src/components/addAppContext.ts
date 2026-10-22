import { createContext, useContext } from 'react';

/** 全局“添加软件”：侧栏悬浮按钮、手机抽屉、右下“＋”与发布台空状态都通过它打开同一个 Sheet。 */
export interface AddAppCtx { open: (platform?: string) => void; count: number; version: number }
export const AddAppContext = createContext<AddAppCtx>({ open: () => {}, count: 0, version: 0 });
export const useAddApp = () => useContext(AddAppContext);
