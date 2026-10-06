import { useState } from 'react';
import type { Account } from '../App';
import type { ConversationSummary } from '../lib/chatStore';

interface ConversationsPanelProps {
    conversations: ConversationSummary[];
    activeId: string | null;
    account: Account | null;
    storeKind: 'supabase' | 'local';
    onNew: () => void;
    onSelect: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
    onClose: () => void;
}

const relative = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

function timeAgo(at: number): string {
    const seconds = Math.round((at - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    if (abs < 60) return 'vừa xong';
    if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
    if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
    if (abs < 86400 * 7) return relative.format(Math.round(seconds / 86400), 'day');
    return new Date(at).toLocaleDateString('vi-VN');
}

/** Bảng quản lý các cuộc trò chuyện (phiên chat) + tài khoản đang đăng nhập. */
export default function ConversationsPanel({
    conversations,
    activeId,
    account,
    storeKind,
    onNew,
    onSelect,
    onRename,
    onDelete,
    onClose,
}: ConversationsPanelProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const [signingOut, setSigningOut] = useState(false);

    const startEdit = (conversation: ConversationSummary) => {
        setEditingId(conversation.id);
        setDraft(conversation.title);
    };

    const commitEdit = () => {
        if (editingId && draft.trim()) onRename(editingId, draft);
        setEditingId(null);
    };

    return (
        <section className="settings sessions" aria-label="Các cuộc trò chuyện">
            <header className="settings__header">
                <h2>💬 Các cuộc trò chuyện</h2>
                <button type="button" className="icon-button" onClick={onClose} title="Đóng">
                    ✕
                </button>
            </header>

            <div className="sessions__new">
                <button
                    type="button"
                    className="sessions__new-button"
                    onClick={() => {
                        onNew();
                        onClose();
                    }}
                >
                    ＋ Cuộc trò chuyện mới
                </button>
            </div>

            <ul className="sessions__list">
                {conversations.length === 0 && (
                    <li className="sessions__empty">Chưa có cuộc trò chuyện nào — nói gì đó với Kei để bắt đầu nhé~</li>
                )}
                {conversations.map(conversation => {
                    const active = conversation.id === activeId;
                    const editing = conversation.id === editingId;
                    return (
                        <li key={conversation.id} className={`sessions__item${active ? ' sessions__item--active' : ''}`}>
                            {editing ? (
                                <input
                                    className="text-input sessions__rename"
                                    value={draft}
                                    autoFocus
                                    maxLength={120}
                                    onChange={event => setDraft(event.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter') commitEdit();
                                        if (event.key === 'Escape') setEditingId(null);
                                    }}
                                />
                            ) : (
                                <button
                                    type="button"
                                    className="sessions__open"
                                    onClick={() => {
                                        onSelect(conversation.id);
                                        onClose();
                                    }}
                                >
                                    <span className="sessions__title">{conversation.title}</span>
                                    <small>{timeAgo(conversation.updatedAt)}</small>
                                </button>
                            )}
                            {!editing && (
                                <span className="sessions__actions">
                                    <button
                                        type="button"
                                        className="icon-button"
                                        title="Đổi tên"
                                        onClick={() => startEdit(conversation)}
                                    >
                                        ✎
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-button sessions__delete"
                                        title="Xoá cuộc trò chuyện"
                                        onClick={() => {
                                            if (window.confirm(`Xoá "${conversation.title}"? Không thể hoàn tác.`)) {
                                                onDelete(conversation.id);
                                            }
                                        }}
                                    >
                                        🗑
                                    </button>
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>

            <footer className="sessions__account">
                {account ? (
                    <>
                        <span className="sessions__avatar" aria-hidden="true">
                            {account.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="sessions__who">
                            <strong>{account.name}</strong>
                            <small>{account.email}</small>
                        </span>
                        <button
                            type="button"
                            className="ghost-button"
                            disabled={signingOut}
                            onClick={() => {
                                setSigningOut(true);
                                void account.onSignOut().finally(() => setSigningOut(false));
                            }}
                        >
                            {signingOut ? 'Đang thoát…' : 'Đăng xuất'}
                        </button>
                    </>
                ) : (
                    <small className="sessions__local">
                        {storeKind === 'local'
                            ? '💾 Đang lưu trong trình duyệt này (chưa bật đăng nhập).'
                            : 'Chưa đăng nhập.'}
                    </small>
                )}
            </footer>
        </section>
    );
}
