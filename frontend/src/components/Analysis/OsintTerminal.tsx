import { useState, useRef, useEffect } from 'react';
import { queryOsintChat } from '../../api/client';

interface Message {
    role: 'user' | 'system';
    content: string;
}

export default function OsintTerminal() {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'system', content: '>>> [OSINT 战术终端已激活]\n>>> 正在挂载本地情报知识库...\n>>> 随时可以提问 (如: "简述过去 24 小时红海局势")' }
    ]);
    const [inputMsg, setInputMsg] = useState('');
    const [isLoading, setIsLoading] = useState(false);
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
        setMessages(prev => [...prev, { role: 'user', content: q }]);
        setIsLoading(true);

        try {
            const res = await queryOsintChat(q);
            setMessages(prev => [...prev, { role: 'system', content: res.reply }]);
        } catch (err) {
            console.error("OSINT Query failed:", err);
            setMessages(prev => [...prev, { role: 'system', content: '[ERR] 神经链路阻断：无法连接到本地大语言推理模型，或请求超时。' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', height: '100%',
            background: '#0d1117', border: '1px solid #1e2d40', borderRadius: '4px',
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{
                padding: '6px 10px', background: '#161b22', borderBottom: '1px solid #1e2d40',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
            }}>
                <div style={{ fontSize: '10px', color: '#00d4ff', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', background: '#00d4ff', borderRadius: '50%', boxShadow: '0 0 5px #00d4ff' }} />
                    OSINT 军情终端
                </div>
                <div style={{ fontSize: '9px', color: '#8b9ab0', fontFamily: 'monospace' }}>
                    SECURE CHANNEL 启用
                </div>
            </div>

            {/* Message List */}
            <div ref={scrollRef} style={{
                flex: 1, padding: '10px', overflowY: 'auto',
                fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                fontSize: '11px', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '12px'
            }}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <span style={{ fontSize: '9px', color: msg.role === 'user' ? '#8b9ab0' : '#ffdd00', marginBottom: '2px' }}>
                            {msg.role === 'user' ? 'COMMANDER' : 'SYS_OP'}
                        </span>
                        <div style={{
                            background: msg.role === 'user' ? '#1e2d40' : 'rgba(0, 212, 255, 0.05)',
                            color: msg.role === 'user' ? '#e6edf3' : '#00ff88',
                            padding: '6px 10px', borderRadius: '4px', maxWidth: '90%',
                            borderLeft: msg.role === 'system' ? '2px solid #00d4ff' : 'none',
                            wordBreak: 'break-word', whiteSpace: 'pre-wrap'
                        }}>
                            {msg.content}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '9px', color: '#ffdd00', marginBottom: '2px' }}>SYS_OP</span>
                        <div style={{ color: '#00d4ff', padding: '6px 10px', fontFamily: 'monospace' }}>
                            <span className="typing-dot">_</span> 正在检索数据库并执行态势分析研判...
                        </div>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div style={{
                padding: '8px', background: '#161b22', borderTop: '1px solid #1e2d40',
                display: 'flex', gap: '6px'
            }}>
                <input
                    type="text"
                    value={inputMsg}
                    onChange={e => setInputMsg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                    placeholder="输入军情查询指令..."
                    disabled={isLoading}
                    style={{
                        flex: 1, background: '#0d1117', border: '1px solid #1e2d40', borderRadius: '3px',
                        color: '#e6edf3', padding: '6px 10px', fontSize: '11px', outline: 'none',
                        fontFamily: 'monospace'
                    }}
                />
                <button
                    onClick={handleSend}
                    disabled={isLoading || !inputMsg.trim()}
                    style={{
                        background: isLoading || !inputMsg.trim() ? '#1e2d40' : '#00d4ff',
                        color: isLoading || !inputMsg.trim() ? '#8b9ab0' : '#000',
                        border: 'none', borderRadius: '3px', padding: '0 12px', fontSize: '11px',
                        fontWeight: 600, cursor: isLoading || !inputMsg.trim() ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s', textTransform: 'uppercase'
                    }}
                >
                    发送
                </button>
            </div>
        </div>
    );
}
