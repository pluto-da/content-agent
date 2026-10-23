import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { useT } from '../i18n';
import { Icon } from '../icons';
import { detectPlatform, writePlatform, WRITE_PLATFORMS } from '../data/platforms';
import { compose, parseIntent, revise, type Draft } from '../services';
import { Busy, Problem } from '../ui';
import { DraftCard } from './DraftCard';

/**
 * 一句话驱动主线（原则 2）：“帮我找今天的选题” → 找选题；“写一篇小红书：通勤时间怎么利用” → 生成；
 * “把这篇改得更口语一点” → 改写刚才那篇。结果以卡片出现在输入框下方，卡片上有“编辑”“去发布”。
 */
export function Composer({ go, onPlus, autoFocus, initialPlatform = 'xiaohongshu', placeholder, onDone, suggestions, initialText }: {
  go: (to: string) => void; initialText?: string; onPlus?: () => void; autoFocus?: boolean; initialPlatform?: string; placeholder?: string;
  onDone?: (d: Draft) => void; suggestions?: { label: string; text?: string; to?: string }[];
}) {
  const { t } = useT();
  const [text, setText] = useState(initialText ?? '');
  const [platform, setPlatform] = useState(initialPlatform);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ draft: Draft; ms?: number; note?: string } | null>(null);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const run = async (raw: string) => {
    const intent = parseIntent(raw, detectPlatform);
    setErr(null);
    if (intent.kind === 'topics') { go('topics'); return; }
    if (intent.kind === 'revise') {
      if (!result) { setErr(new ApiError('no_draft', '还没有可以改的那篇', '先输入一个想法生成一篇，再说“改得更口语一点”')); return; }
      setBusy(t('ui.rewriting'));
      try { const d = await revise(result.draft, intent.instruction); setResult({ draft: d, note: t('ui.rewritten_as_requested') }); setText(''); }
      catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e))); }
      finally { setBusy(null); }
      return;
    }
    const p = intent.platform ?? platform;
    if (intent.platform) setPlatform(intent.platform);
    setBusy(`${t('ui.writing')}${writePlatform(p).label}…`);
    try {
      const r = await compose(intent.idea, p);
      setResult({ draft: r.draft, ms: r.ms, note: r.suggestBackup ? t('ui.your_first_post_is_ready') : undefined });
      setText('');
      onDone?.(r.draft);
    } catch (e) { setErr(e instanceof ApiError ? e : new ApiError('error', String(e))); }
    finally { setBusy(null); }
  };

  /** 系统语音输入（Web Speech API，可用时）；不可用时提示用键盘自带的语音键。 */
  const voice = () => {
    const W = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SR) { setErr(new ApiError('no_voice', '这台设备不支持网页语音输入', '可以用输入法键盘上的麦克风键说话')); return; }
    const r = new SR(); r.lang = 'zh-CN'; r.interimResults = false;
    r.onresult = (e: any) => setText(String(e.results?.[0]?.[0]?.transcript ?? ''));
    r.onend = () => setListening(false);
    setListening(true); r.start();
  };

  const isModelErr = err?.code?.startsWith('model_');
  return (
    <div className="flex flex-col gap-3">
      <form className="ask" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) void run(text); }} aria-label={t('ui.start_with_one_sentence')}>
        {onPlus && <button type="button" className="ghost ask-btn" aria-label={t('ui.add_app')} onClick={onPlus}><Icon name="plus" size={20} /></button>}
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? t('ui.tell_me_an_idea_and')} aria-label={t('ui.type_an_idea')} enterKeyHint="send" data-testid="ask-input" />
        <button type="button" className="ghost ask-btn" aria-label={listening ? t('ui.listening') : t('ui.voice_input')} onClick={voice}><Icon name="mic" size={20} /></button>
        <button type="submit" className="primary ask-btn" aria-label={t('ui.generate')} disabled={!text.trim() || !!busy} data-testid="ask-send"><Icon name="arrowUp" size={20} /></button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        <span className="kbd-hint">{t('ui.write_as')}</span>
        <select aria-label={t('ui.which_platform_to_write_for')} value={platform} onChange={(e) => setPlatform(e.target.value)} className="!w-auto !min-h-10">
          {WRITE_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {busy && <Busy label={busy} />}
      </div>
      {suggestions && !result && !busy && (
        <div className="suggest" aria-label={t('ui.try_saying')}>
          {suggestions.map((s) => <button key={s.label} type="button" onClick={() => (s.to ? go(s.to) : s.text ? void run(s.text) : undefined)}>{s.label}</button>)}
        </div>
      )}
      {err && <Problem title={err.message} advice={err.advice} action={isModelErr ? t('ui.check_models') : undefined} onAction={isModelErr ? () => go('me/models') : undefined} />}
      {result && <DraftCard draft={result.draft} go={go} ms={result.ms} note={result.note} />}
    </div>
  );
}
