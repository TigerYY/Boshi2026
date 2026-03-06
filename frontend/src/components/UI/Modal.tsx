import { type ReactNode, useEffect, useState, useRef } from 'react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    width?: string | number;
    height?: string | number;
}

export default function Modal({ isOpen, onClose, title, children, width = 300, height = '60vh' }: ModalProps) {
    const [pos, setPos] = useState({ x: 100, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const windowRef = useRef<HTMLDivElement>(null);

    // Set initial position to bottom-right area on first open
    useEffect(() => {
        if (isOpen) {
            const w = window.innerWidth;
            const modalW = typeof width === 'number' ? width : 300;
            // Align with the 300px right side panel (with a small margin)
            setPos({ x: w - modalW - 10, y: 60 });
        }
    }, [isOpen, width]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            setPos({
                x: e.clientX - dragStart.current.x,
                y: e.clientY - dragStart.current.y
            });
        };
        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            document.addEventListener('keydown', handleEsc);
        }
        return () => {
            document.removeEventListener('keydown', handleEsc);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            ref={windowRef}
            style={{
                position: 'fixed',
                left: pos.x,
                top: pos.y,
                width, height,
                zIndex: 5000,
                display: 'flex', flexDirection: 'column',
                background: 'rgba(13, 17, 23, 0.9)',
                backdropFilter: 'blur(12px)',
                border: '1px solid #1e2d40',
                borderRadius: 8,
                boxShadow: '0 20px 50px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,212,255,0.1)',
                overflow: 'hidden',
                pointerEvents: 'auto'
            }}
        >
            {/* Header / Drag Handle */}
            <div
                onMouseDown={(e) => {
                    setIsDragging(true);
                    dragStart.current = {
                        x: e.clientX - pos.x,
                        y: e.clientY - pos.y
                    };
                }}
                style={{
                    height: 42,
                    borderBottom: '1px solid #1e2d40',
                    padding: '0 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: 'rgba(30, 45, 64, 0.4)',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    userSelect: 'none'
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 16 }}>👨‍✈️</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#00d4ff', letterSpacing: '0.05em' }}>{title}</span>
                </div>
                <button
                    onClick={onClose}
                    onMouseDown={e => e.stopPropagation()} // Prevent drag when clicking close
                    style={{
                        background: 'transparent', border: 'none', color: '#445566', cursor: 'pointer',
                        fontSize: 20, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'color 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ff2244'}
                    onMouseLeave={e => e.currentTarget.style.color = '#445566'}
                >
                    ×
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'hidden', padding: 8, display: 'flex', flexDirection: 'column' }}>
                {children}
            </div>
        </div>
    );
}
