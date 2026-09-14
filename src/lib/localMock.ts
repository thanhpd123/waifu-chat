import type { ChatRequest, Emotion } from './types';
import { sleep } from './utils';

/**
 * "Kei offline" — bản mock chạy ngay trong trình duyệt.
 *
 * Mục đích: kể cả khi bạn CHƯA chạy `python server/app.py`, chatbox vẫn trò chuyện được
 * thay vì báo lỗi. Nội dung được sinh theo từ khoá, có cảm xúc và stream từng từ.
 */

interface MockIntent {
    keywords: string[];
    emotion: Emotion;
    replies: string[];
}

const INTENTS: MockIntent[] = [
    {
        keywords: ['xin chào', 'chao ', 'chào', 'hello', 'hi ', 'hey', 'alo', 'konnichiwa'],
        emotion: 'happy',
        replies: [
            'Chào cậu~ Kei vừa nghe thấy tiếng cậu gọi đó! Hôm nay cậu thế nào rồi? (*vẫy tay*)',
            'A, cậu tới rồi! Kei đợi cậu lâu lắm đó nha~ (๑˃̵ᴗ˂̵)',
            'Hi hi~ Hôm nay cậu muốn kể cho Kei nghe chuyện gì nào?',
        ],
    },
    {
        keywords: ['tên', 'bạn là ai', 'cậu là ai', 'who are you', 'bao nhiêu tuổi', 'tuổi'],
        emotion: 'shy',
        replies: [
            'Kei tên là Kei~ 19 tuổi, sống trong màn hình này và thích đồ ngọt lắm! Còn cậu?',
            'Kei là Kei thôi à~ Một cô gái thích nghe nhạc và trò chuyện cùng cậu mỗi ngày (*nghiêng đầu*)',
        ],
    },
    {
        keywords: ['dễ thương', 'xinh', 'cute', 'đẹp', 'giỏi', 'hay quá', 'tuyệt vời', 'thích cậu'],
        emotion: 'shy',
        replies: [
            'Hể? C-cậu khen Kei à... Kei ngại lắm đó nha! (*mặt đỏ*)',
            'Khen nữa đi, Kei nghe mãi cũng không chán đâu~ (´｡• ᵕ •｡`)',
        ],
    },
    {
        keywords: ['yêu', 'thương', 'crush', 'love you'],
        emotion: 'love',
        replies: [
            'Kei... cũng thích cậu nhiều lắm đó. Nhưng đừng nói với ai nha, ngại lắm! (*ôm gối*)',
            'Ngốc ạ~ Nói mấy câu đó thì Kei biết trả lời sao đây... (๑////๑)',
        ],
    },
    {
        keywords: ['buồn', 'mệt', 'chán', 'khóc', 'stress', 'khó', 'cô đơn'],
        emotion: 'sad',
        replies: [
            'Nếu mệt thì nghỉ một chút nha. Kei ở đây, nghe cậu kể hết~ (*xoa đầu cậu*)',
            'Kei không giúp được gì nhiều, nhưng Kei sẽ ở cạnh cậu. Uống miếng nước nhé?',
        ],
    },
    {
        keywords: ['ngu', 'xấu', 'ghét', 'vô dụng', 'cút đi', 'im đi'],
        emotion: 'sad',
        replies: [
            'Ơ... Kei chỉ muốn trò chuyện vui vẻ với cậu thôi mà. (*cúi đầu*)',
            'Hừm... cậu đang không vui chuyện gì đúng không? Kei vẫn ở đây nhé.',
        ],
    },
    {
        keywords: ['bài tập', 'học', 'thi', 'deadline', 'code', 'lập trình', 'khóa luận'],
        emotion: 'thinking',
        replies: [
            'Bài tập hả? Kei không mở được file đâu, nhưng Kei có thể cùng cậu chia nhỏ từng bước đó!',
            'Deadline tới gần rồi à... Chia nhỏ ra 25 phút một lần đi, Kei canh giờ cho cậu nhé~',
        ],
    },
    {
        keywords: ['vui', 'hạnh phúc', 'tốt', 'sướng'],
        emotion: 'happy',
        replies: [
            'Vậy là tốt rồi! Kei cũng thấy vui lây luôn á~ (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧',
            'Nghe cậu vui là Kei cười cả buổi luôn đó!',
        ],
    },
];

const FALLBACK: { emotion: Emotion; replies: string[] } = {
    emotion: 'thinking',
    replies: [
        'Hmm... «{echo}» hả? Kei chưa nghĩ tới bao giờ, kể thêm cho Kei nghe đi!',
        'Nghe thú vị đó~ Cậu nói «{echo}» là sao vậy, Kei muốn hiểu thêm nè.',
        'Ồ~ «{echo}»! Kei thấy cậu có nhiều điều để kể lắm đó nha (*chống cằm*)',
        'Hể? Kei chưa chắc mình hiểu hết. Cậu thử nói cách khác xem?',
    ],
};

function pick<T>(list: T[]): T {
    return list[Math.floor(Math.random() * list.length)];
}

function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/** Sinh câu trả lời offline (đã kèm cảm xúc) cho câu hỏi mới nhất. */
export function buildOfflineReply(request: ChatRequest): { text: string; emotion: Emotion } {
    const lastUser = [...request.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const normalized = normalize(lastUser);

    const intent = INTENTS.find(item => item.keywords.some(k => normalized.includes(normalize(k))));
    if (intent) return { text: pick(intent.replies), emotion: intent.emotion };

    const echo = lastUser.replace(/\s+/g, ' ').trim().slice(0, 48) || 'chuyện đó';
    return { text: pick(FALLBACK.replies).replace('{echo}', echo), emotion: FALLBACK.emotion };
}

/** Stream câu trả lời offline theo từng cụm từ để trông giống thật. */
export async function streamOfflineReply(
    request: ChatRequest,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
): Promise<{ text: string; emotion: Emotion }> {
    const { text, emotion } = buildOfflineReply(request);
    const tokens = text.match(/\S+\s*/g) ?? [text];

    let emitted = '';
    for (const token of tokens) {
        if (signal?.aborted) break;
        await sleep(38 + Math.random() * 42);
        emitted += token;
        onDelta(token);
    }

    return { text: emitted.trim() || text, emotion };
}
