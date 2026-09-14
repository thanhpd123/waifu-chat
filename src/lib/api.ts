import { normalizeEmotion } from './emotion';
import { streamOfflineReply } from './localMock';
import type { ChatRequest, Emotion, EngineInfo, HealthPayload, StreamEvent } from './types';

/**
 * Lớp giao tiếp với backend Kei (`server/app.py`) qua Server-Sent Events.
 *
 * Nếu backend chưa chạy (hoặc mất mạng), tự động rơi về "Kei offline" chạy trong
 * trình duyệt → chatbox không bao giờ báo lỗi trắng.
 */

export interface StreamHandlers {
    onMeta?: (engine: EngineInfo) => void;
    onEmotion?: (emotion: Emotion) => void;
    onDelta?: (text: string) => void;
    /** Thông báo phụ (ví dụ: backend lỗi key, đang dùng chế độ offline). */
    onNotice?: (message: string) => void;
    onDone?: (payload: { text: string; emotion: Emotion; offline: boolean }) => void;
    onError?: (message: string) => void;
}

const STREAM_ENDPOINT = '/api/chat/stream';
const HEALTH_ENDPOINT = '/api/health';

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

function dispatch(event: StreamEvent, handlers: StreamHandlers, state: { sawDone: boolean }): void {
    switch (event.type) {
        case 'meta':
            handlers.onMeta?.(event.engine);
            break;
        case 'emotion':
            handlers.onEmotion?.(normalizeEmotion(event.emotion));
            break;
        case 'delta':
            handlers.onDelta?.(event.text);
            break;
        case 'notice':
            handlers.onNotice?.(event.message);
            break;
        case 'done':
            state.sawDone = true;
            handlers.onDone?.({
                text: event.text,
                emotion: normalizeEmotion(event.emotion),
                offline: false,
            });
            break;
        case 'error':
            handlers.onError?.(event.message);
            break;
        default:
            break;
    }
}

async function readSSE(
    response: Response,
    handlers: StreamHandlers,
    signal: AbortSignal | undefined,
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    const state = { sawDone: false };
    let buffer = '';

    try {
        for (; ;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (signal?.aborted) break;

            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf('\n\n');
            while (boundary !== -1) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                boundary = buffer.indexOf('\n\n');

                const dataLine = frame
                    .split('\n')
                    .map(line => line.trim())
                    .find(line => line.startsWith('data:'));

                if (!dataLine) continue;
                try {
                    const parsed = JSON.parse(dataLine.slice(5).trim()) as StreamEvent;
                    dispatch(parsed, handlers, state);
                } catch {
                    /* khung SSE hỏng → bỏ qua, không làm chết luồng */
                }
            }
        }
    } finally {
        try {
            await reader.cancel();
        } catch {
            /* ignore */
        }
    }
}

/**
 * Gửi hội thoại lên Kei và nhận phản hồi dạng stream.
 * Luôn resolve (không throw) trừ khi bị huỷ giữa chừng.
 */
export async function streamChat(
    request: ChatRequest,
    handlers: StreamHandlers,
    signal?: AbortSignal,
): Promise<void> {
    let offlineReason = 'Không kết nối được tới server Kei (chưa chạy `python server/app.py`?).';
    let produced = false;

    const tracked: StreamHandlers = {
        ...handlers,
        onDelta: text => {
            if (text.trim()) produced = true;
            handlers.onDelta?.(text);
        },
    };

    try {
        const response = await fetch(STREAM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
            signal,
        });

        if (!response.ok) {
            offlineReason = `Server Kei trả về lỗi HTTP ${response.status}.`;
            throw new Error(offlineReason);
        }
        if (!response.body) {
            offlineReason = 'Trình duyệt không hỗ trợ đọc stream.';
            throw new Error(offlineReason);
        }

        await readSSE(response, tracked, signal);

        if (produced) return; // Đã có câu trả lời thật → xong.
        // Server trả 200 nhưng không có nội dung → thử lại bằng mock offline.
    } catch (error) {
        if (isAbort(error)) return;
        if (error instanceof Error && error.message.startsWith('Server Kei')) {
            offlineReason = error.message;
        }
    }

    if (signal?.aborted) return;

    handlers.onNotice?.(`${offlineReason} Kei đang dùng chế độ trò chuyện offline nha!`);
    handlers.onMeta?.({ kind: 'local-mock', label: 'Kei Offline', model: 'trong-trình-duyệt', online: false });

    try {
        const result = await streamOfflineReply(
            request,
            chunk => handlers.onDelta?.(chunk),
            signal,
        );
        handlers.onDone?.({ text: result.text, emotion: result.emotion, offline: true });
    } catch (error) {
        if (isAbort(error)) return;
        handlers.onError?.('Kei bị lỗi không mong đợi. Cậu thử lại giúp Kei nhé!');
    }
}

/** Kiểm tra backend có sống không + lấy danh sách persona/ngôn ngữ. */
export async function fetchHealth(timeoutMs = 2500): Promise<HealthPayload | null> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(HEALTH_ENDPOINT, { signal: controller.signal });
        if (!response.ok) return null;
        return (await response.json()) as HealthPayload;
    } catch {
        return null;
    } finally {
        window.clearTimeout(timer);
    }
}
