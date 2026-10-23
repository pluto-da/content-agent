/**
 * 适配器注册（ADR-002）：新增一家服务商 = 新建 adapters/<vendor>.ts（实现 Adapter）+ 在下面列表加一行。核心（runner / 路由 / 界面）不改。
 */
import { Registry } from '../../core/registry.js';
import type { Adapter } from './types.js';
import openaiCompatible from './openai-compatible.js';
import mimo from './mimo.js';
import dashscope from './dashscope.js';
import deepseek from './deepseek.js';
import zhipu from './zhipu.js';
import ark from './ark.js';
import minimax from './minimax.js';
import stepfun from './stepfun.js';
import kimi from './kimi.js';
import openai from './openai.js';
import gemini from './gemini.js';
import siliconflow from './siliconflow.js';
import replicate from './replicate.js';
import elevenlabs from './elevenlabs.js';
import ollama from './ollama.js';
import comfyui from './comfyui.js';
import anthropic from './anthropic.js';
import mock from './mock.js';

export const ADAPTERS = new Registry<Adapter>('服务商适配器');
for (const a of [mimo, dashscope, deepseek, zhipu, ark, minimax, stepfun, kimi, openai, gemini, siliconflow, replicate, elevenlabs, ollama, comfyui, anthropic, openaiCompatible, mock]) ADAPTERS.register(a);
ADAPTERS.freeze();
export const adapterOf = (vendor: string): Adapter | undefined => ADAPTERS.get(vendor);
export * from './types.js';
export { mockFailureFor, MockFailure } from './mock.js';
export { workflowCheckpoint } from './comfyui.js';
