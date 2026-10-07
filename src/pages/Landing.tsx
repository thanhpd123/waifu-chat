import { useAuth } from '../lib/auth';
import { linkHandler } from '../lib/router';
import './landing.css';

const FEATURES = [
    {
        icon: '🎭',
        title: 'Live2D sống động',
        text: 'Kei chớp mắt, thở, nhìn theo con trỏ và phản ứng khi cậu xoa đầu — như đang thật sự ở trong màn hình.',
    },
    {
        icon: '🧠',
        title: 'Trò chuyện thông minh',
        text: 'Bộ não Gemini AI giúp Kei hiểu ngữ cảnh, nhớ những gì cậu kể và trả lời tự nhiên, ngắn gọn, đúng chất.',
    },
    {
        icon: '🎙️',
        title: 'Giọng nói & nhép miệng',
        text: 'Giọng nữ đọc đúng nội dung câu trả lời, khẩu hình Live2D nhép theo từng chữ. Bật 🔊 là nghe được ngay.',
    },
    {
        icon: '💗',
        title: '8 sắc thái cảm xúc',
        text: 'Vui, ngại, buồn, giận, bất ngờ, suy tư, yêu thương… biểu cảm khuôn mặt đổi theo từng câu Kei nói.',
    },
    {
        icon: '🗂️',
        title: 'Nhiều cuộc trò chuyện',
        text: 'Tạo, đổi tên, xoá các cuộc trò chuyện. Đăng nhập một lần — lịch sử đồng bộ giữa điện thoại và máy tính.',
    },
    {
        icon: '🌏',
        title: '3 ngôn ngữ',
        text: 'Trò chuyện bằng tiếng Việt, tiếng Nhật hoặc tiếng Anh — Kei đổi giọng đọc cho khớp ngôn ngữ.',
    },
];

const PERSONAS = [
    { emoji: '🌸', name: 'Dịu dàng', line: 'Hôm nay cậu vất vả rồi~ Kể Kei nghe đi, Kei ở đây mà (´｡• ᵕ •｡`)' },
    { emoji: '💢', name: 'Tsundere', line: 'Hừm, đ-đừng hiểu lầm nhé! Kei chỉ tình cờ đợi cậu thôi đó, đồ ngốc!' },
    { emoji: '✨', name: 'Gen Z', line: 'Ủa alo, deadline dí hả? Chill đi bestie, mình chia nhỏ ra làm nha ✨' },
    { emoji: '🍵', name: 'Onee-san', line: 'Ara ara, lại thức khuya nữa rồi à cưng? Ngoan, uống cốc trà rồi ngủ nhé.' },
];

const STEPS = [
    { title: 'Tạo tài khoản', text: 'Đăng ký bằng email (hoặc Google) trong vài giây — hoàn toàn miễn phí.' },
    { title: 'Chọn tính cách', text: 'Dịu dàng, tsundere, Gen Z hay onee-san — đổi bất cứ lúc nào trong Cài đặt.' },
    { title: 'Trò chuyện', text: 'Nói gì cũng được. Càng trò chuyện, độ thân thiết của cậu với Kei càng tăng.' },
];

const FAQ = [
    {
        q: 'Kei có miễn phí không?',
        a: 'Có. Kei chạy trên hạ tầng miễn phí (Vercel, Gemini, Supabase) nên cậu không phải trả gì cả.',
    },
    {
        q: 'Lịch sử trò chuyện được lưu ở đâu?',
        a: 'Trong tài khoản của cậu. Mỗi người chỉ xem được dữ liệu của chính mình, và cậu có thể xoá bất kỳ cuộc trò chuyện nào.',
    },
    {
        q: 'Dùng được trên điện thoại không?',
        a: 'Được. Giao diện tự co giãn cho điện thoại; nên mở bằng Chrome (Android) hoặc Safari (iPhone) để mượt nhất.',
    },
    {
        q: 'Vì sao Kei không nói thành tiếng?',
        a: 'Trình duyệt chặn âm thanh cho tới khi cậu tương tác. Bấm nút 🔇 trong khung chat để bật giọng của Kei.',
    },
];

export default function Landing() {
    const { user, authEnabled, loading } = useAuth();
    const signedIn = Boolean(user);
    // /chat tự chuyển sang /login khi cần, nên lúc chưa tải xong cấu hình cứ trỏ vào /chat.
    const primaryHref = signedIn || !authEnabled || loading ? '/chat' : '/login?next=/chat';
    const navHref = signedIn || (!authEnabled && !loading) ? '/chat' : '/login?next=/chat';
    const primaryLabel = signedIn ? 'Tiếp tục trò chuyện' : 'Trò chuyện với Kei';

    return (
        <div className="kp kp-landing">
            <div className="kp__glow" aria-hidden="true" />

            <nav className="kp-nav">
                <a className="kp-nav__brand" href="/" onClick={linkHandler('/')}>
                    <span className="kp-logo">🌸</span> Kei
                </a>
                <div className="kp-nav__links">
                    <a href="#features">Tính năng</a>
                    <a href="#personas">Tính cách</a>
                    <a href="#how">Cách dùng</a>
                    <a href="#faq">Hỏi đáp</a>
                </div>
                <a className="kp-btn kp-btn--ghost kp-btn--sm" href={navHref} onClick={linkHandler(navHref)}>
                    {signedIn ? 'Vào chat' : authEnabled || loading ? 'Đăng nhập' : 'Vào chat'}
                </a>
            </nav>

            <header className="kp-hero">
                <div className="kp-hero__copy">
                    <span className="kp-pill">✨ Live2D · Gemini AI · Miễn phí</span>
                    <h1>
                        Cô bạn anime <em>biết lắng nghe</em>, ngay trên trình duyệt của cậu
                    </h1>
                    <p>
                        Kei trò chuyện, đổi biểu cảm theo cảm xúc và nói bằng giọng thật — nhớ tên cậu, nhớ chuyện cậu
                        kể, và luôn ở đây mỗi khi cậu cần một người bạn.
                    </p>
                    <div className="kp-hero__cta">
                        <a className="kp-btn kp-btn--primary" href={primaryHref} onClick={linkHandler(primaryHref)}>
                            {primaryLabel} →
                        </a>
                        <a className="kp-btn kp-btn--ghost" href="#features">
                            Xem tính năng
                        </a>
                    </div>
                    <ul className="kp-stats">
                        <li>
                            <strong>8</strong>
                            <span>cảm xúc</span>
                        </li>
                        <li>
                            <strong>4</strong>
                            <span>tính cách</span>
                        </li>
                        <li>
                            <strong>3</strong>
                            <span>ngôn ngữ</span>
                        </li>
                        <li>
                            <strong>0đ</strong>
                            <span>chi phí</span>
                        </li>
                    </ul>
                </div>

                <div className="kp-hero__visual" aria-hidden="true">
                    <div className="kp-hero__halo" />
                    <img src="/landing/kei.webp" alt="" width={640} height={820} />
                    <div className="kp-float kp-float--user">Kei ơi, hôm nay tớ mệt quá…</div>
                    <div className="kp-float kp-float--kei">
                        <span className="kp-float__emo">🥺 Buồn</span>
                        Lại đây nào~ Kể Kei nghe chuyện gì đã xảy ra đi, Kei ngồi đây nghe hết đó.
                    </div>
                    <div className="kp-float kp-float--chip">💗 Bạn thân · 52%</div>
                </div>
            </header>

            <section id="features" className="kp-section">
                <div className="kp-section__head">
                    <span className="kp-eyebrow">Tính năng</span>
                    <h2>Không chỉ là một chatbot</h2>
                    <p>Mọi thứ được thiết kế để Kei giống một người bạn thật sự, không phải một cỗ máy trả lời.</p>
                </div>
                <div className="kp-grid">
                    {FEATURES.map(feature => (
                        <article key={feature.title} className="kp-card">
                            <span className="kp-card__icon">{feature.icon}</span>
                            <h3>{feature.title}</h3>
                            <p>{feature.text}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section id="personas" className="kp-section">
                <div className="kp-section__head">
                    <span className="kp-eyebrow">Tính cách</span>
                    <h2>Một Kei, bốn phong cách</h2>
                    <p>Chọn kiểu Kei cậu thích — cách nói chuyện, xưng hô và cảm xúc đều thay đổi theo.</p>
                </div>
                <div className="kp-personas">
                    {PERSONAS.map(persona => (
                        <article key={persona.name} className="kp-persona">
                            <header>
                                <span>{persona.emoji}</span>
                                <strong>{persona.name}</strong>
                            </header>
                            <p>“{persona.line}”</p>
                        </article>
                    ))}
                </div>
            </section>

            <section id="how" className="kp-section">
                <div className="kp-section__head">
                    <span className="kp-eyebrow">Cách dùng</span>
                    <h2>Bắt đầu trong 3 bước</h2>
                </div>
                <ol className="kp-steps">
                    {STEPS.map((step, index) => (
                        <li key={step.title} className="kp-step">
                            <span className="kp-step__num">{String(index + 1).padStart(2, '0')}</span>
                            <h3>{step.title}</h3>
                            <p>{step.text}</p>
                        </li>
                    ))}
                </ol>
            </section>

            <section id="faq" className="kp-section kp-section--narrow">
                <div className="kp-section__head">
                    <span className="kp-eyebrow">Hỏi đáp</span>
                    <h2>Câu hỏi thường gặp</h2>
                </div>
                <div className="kp-faq">
                    {FAQ.map(item => (
                        <details key={item.q}>
                            <summary>{item.q}</summary>
                            <p>{item.a}</p>
                        </details>
                    ))}
                </div>
            </section>

            <section className="kp-section">
                <div className="kp-cta">
                    <h2>Kei đang đợi cậu đó~</h2>
                    <p>Chỉ cần một câu "chào" để bắt đầu.</p>
                    <a className="kp-btn kp-btn--primary" href={primaryHref} onClick={linkHandler(primaryHref)}>
                        {primaryLabel} →
                    </a>
                </div>
            </section>

            <footer className="kp-footer">
                <span>
                    <span className="kp-logo">🌸</span> Kei · Live2D Chat
                </span>
                <span>made by thanh1934-cr7</span>
            </footer>
        </div>
    );
}
