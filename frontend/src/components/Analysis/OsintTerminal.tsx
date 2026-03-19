import { useState, useRef, useEffect } from 'react';
import {
  queryOsintChat,
  type OsintChatResult,
} from '../../api/client';
import type { AxiosError } from 'axios';

type ChatMsg =
  | { role: 'user'; content: string }
  | { role: 'system'; content: string }
  | { role: 'assistant'; data: OsintChatResult };

const LOOKBACK_OPTIONS = [3, 7, 14, 30] as const;

function errMessage(err: unknown): { tag: string; text: string } {
  const e = err as AxiosError<{ detail?: string }>;
  if (e.code === 'ECONNABORTED') {
    return {
      tag: 'TIMEOUT',
      text: '请求超时（>300s）。若本机 Ollama/LM Studio 仍在推理，可稍后重试或缩短回溯天数。',
    };
  }
  const st = e.response?.status;
  const detail =
    typeof e.response?.data?.detail === 'string'
      ? e.response.data.detail
      : Array.isArray(e.response?.data?.detail)
        ? JSON.stringify(e.response?.data?.detail)
        : '';
  if (st === 503) {
    return {
      tag: 'BUSY',
      text: detail || '推理通道繁忙，请数秒后重试。',
    };
  }
  if (st === 500) {
    return {
      tag: 'SERVER',
      text: detail || '服务端推理失败。',
    };
  }
  if (st === 400) {
    return { tag: 'BAD_REQ', text: detail || '请求无效。' };
  }
  return {
    tag: 'NET',
    text: e.message || '无法连接后端或 Ollama 链路中断。',
  };
}

export default function OsintTerminal() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'system',
      content:
        '>>> [OSINT 战术终端已激活]\n>>> 正在挂载本地情报知识库...\n>>> 可随时提问（如：简述过去 24 小时红海局势）\n>>> 可调「回溯天数」扩大情报取样窗口。',
    },
  ]);
  const [inputMsg, setInputMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lookbackDays, setLookbackDays] = useState(7);
  const [showCitations, setShowCitations] = useState<Record<number, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const q = inputMsg.trim();
    if (!q || isLoading) return;

    setInputMsg('');
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setIsLoading(true);

    try {
      const data = await queryOsintChat(q, lookbackDays);
      setMessages((prev) => [...prev, { role: 'assistant', data }]);
    } catch (err) {
      const { tag, text } = errMessage(err);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `[${tag}] ${text}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0d1117',
        border: '1px solid #1e2d40',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          background: '#161b22',
          borderBottom: '1px solid #1e2d40',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: '10px',
            color: '#00d4ff',
            textTransform: 'uppercase',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              background: '#00d4ff',
              borderRadius: '50%',
              boxShadow: '0 0 5px #00d4ff',
            }}
          />
          OSINT 军情终端
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 9, color: '#8b9ab0' }}>
            回溯（天）
            <select
              value={lookbackDays}
              onChange={(e) => setLookbackDays(Number(e.target.value))}
              disabled={isLoading}
              style={{
                marginLeft: 4,
                background: '#0d1117',
                color: '#e6edf3',
                border: '1px solid #1e2d40',
                borderRadius: 2,
                fontSize: 10,
                padding: '2px 4px',
              }}
            >
              {LOOKBACK_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <div style={{ fontSize: '9px', color: '#8b9ab0', fontFamily: 'monospace' }}>
            SECURE CHANNEL
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          padding: '10px',
          overflowY: 'auto',
          fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
          fontSize: '11px',
          lineHeight: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                }}
              >
                <span
                  style={{ fontSize: '9px', color: '#8b9ab0', marginBottom: '2px' }}
                >
                  COMMANDER
                </span>
                <div
                  style={{
                    background: '#1e2d40',
                    color: '#e6edf3',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    maxWidth: '90%',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }
          if (msg.role === 'system') {
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                }}
              >
                <span
                  style={{ fontSize: '9px', color: '#ffdd00', marginBottom: '2px' }}
                >
                  SYS_OP
                </span>
                <div
                  style={{
                    background: 'rgba(0, 212, 255, 0.05)',
                    color: '#00ff88',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    maxWidth: '90%',
                    borderLeft: '2px solid #00d4ff',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }
          const d = msg.data;
          const degraded = d.status === 'degraded';
          const citeOpen = showCitations[i] ?? false;
          const counts = d.meta?.context_counts;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
              }}
            >
              <span
                style={{ fontSize: '9px', color: '#ffdd00', marginBottom: '4px' }}
              >
                SYS_OP
              </span>
              <div
                style={{
                  background: 'rgba(0, 212, 255, 0.06)',
                  borderLeft: '2px solid #00d4ff',
                  borderRadius: '4px',
                  padding: '8px 10px',
                  maxWidth: '95%',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {degraded && (
                  <div
                    style={{
                      fontSize: 10,
                      color: '#ffb347',
                      marginBottom: 8,
                      padding: '4px 6px',
                      background: 'rgba(255, 140, 0, 0.08)',
                      borderRadius: 2,
                    }}
                  >
                    [降级输出]
                    {d.meta?.fallback_reason
                      ? ` ${d.meta.fallback_reason}`
                      : ' 模型解析非最优，以下为可用摘要。'}
                  </div>
                )}
                {d.core_assessment ? (
                  <div style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        fontSize: 9,
                        color: '#00d4ff',
                        textTransform: 'uppercase',
                        marginBottom: 4,
                        letterSpacing: 0.5,
                      }}
                    >
                      核心态势
                    </div>
                    <div style={{ color: '#e6edf3', fontWeight: 600, lineHeight: 1.45 }}>
                      {d.core_assessment}
                    </div>
                  </div>
                ) : null}
                {d.analysis ? (
                  <div style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        fontSize: 9,
                        color: '#00d4ff',
                        textTransform: 'uppercase',
                        marginBottom: 4,
                        letterSpacing: 0.5,
                      }}
                    >
                      深度研判
                    </div>
                    <div
                      style={{
                        color: '#7ee787',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        lineHeight: 1.5,
                      }}
                    >
                      {d.analysis}
                    </div>
                  </div>
                ) : !d.core_assessment ? (
                  <div style={{ color: '#7ee787', whiteSpace: 'pre-wrap' }}>
                    {d.reply || d.answer}
                  </div>
                ) : null}

                {d.citations && d.citations.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setShowCitations((s) => ({ ...s, [i]: !citeOpen }))
                      }
                      style={{
                        background: 'transparent',
                        border: '1px solid #1e2d40',
                        color: '#8b9ab0',
                        fontSize: 9,
                        cursor: 'pointer',
                        padding: '2px 8px',
                        borderRadius: 2,
                      }}
                    >
                      {citeOpen ? '▾ 隐藏依据来源' : '▸ 依据来源'}{' '}
                      ({d.citations.length})
                    </button>
                    {citeOpen && (
                      <ul
                        style={{
                          margin: '6px 0 0',
                          paddingLeft: 16,
                          color: '#8b9ab0',
                          fontSize: 10,
                          maxHeight: 140,
                          overflowY: 'auto',
                        }}
                      >
                        {d.citations.slice(0, 20).map((c) => (
                          <li key={`${c.type}-${c.id}`} style={{ marginBottom: 4 }}>
                            <span style={{ color: '#556677' }}>
                              [{c.type === 'news' ? 'N' : 'E'}
                              {c.id}] {c.time}
                            </span>{' '}
                            {c.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 6,
                    borderTop: '1px solid #1e2d40',
                    fontSize: 9,
                    color: '#556677',
                  }}
                >
                  样本：新闻 {counts?.news ?? 0} · 事件 {counts?.events ?? 0} · 金融锚点{' '}
                  {counts?.finance ?? 0}
                  {d.meta?.latency_ms ? ` · ${d.meta.latency_ms}ms` : ''}
                  {d.meta?.parse_mode ? ` · ${d.meta.parse_mode}` : ''}
                  {d.meta?.request_id ? ` · req ${d.meta.request_id}` : ''}
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            <span
              style={{ fontSize: '9px', color: '#ffdd00', marginBottom: '2px' }}
            >
              SYS_OP
            </span>
            <div
              style={{ color: '#00d4ff', padding: '6px 10px', fontFamily: 'monospace' }}
            >
              <span className="typing-dot">_</span> 检索情报库并执行研判（最长约 300s）…
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          padding: '8px',
          background: '#161b22',
          borderTop: '1px solid #1e2d40',
          display: 'flex',
          gap: '6px',
        }}
      >
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend();
          }}
          placeholder="输入军情查询指令..."
          disabled={isLoading}
          style={{
            flex: 1,
            background: '#0d1117',
            border: '1px solid #1e2d40',
            borderRadius: '3px',
            color: '#e6edf3',
            padding: '6px 10px',
            fontSize: '11px',
            outline: 'none',
            fontFamily: 'monospace',
          }}
        />
        <button
          onClick={handleSend}
          disabled={isLoading || !inputMsg.trim()}
          style={{
            background: isLoading || !inputMsg.trim() ? '#1e2d40' : '#00d4ff',
            color: isLoading || !inputMsg.trim() ? '#8b9ab0' : '#000',
            border: 'none',
            borderRadius: '3px',
            padding: '0 12px',
            fontSize: '11px',
            fontWeight: 600,
            cursor: isLoading || !inputMsg.trim() ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
            textTransform: 'uppercase',
          }}
        >
          发送
        </button>
      </div>
    </div>
  );
}
