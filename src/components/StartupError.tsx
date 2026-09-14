interface StartupErrorProps {
    message: string;
}

/** Màn hình lỗi hiển thị khi không thể khởi động (thiếu Live2D Cubism Core). */
export default function StartupError({ message }: StartupErrorProps) {
    return (
        <div
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
                padding: '2rem',
                textAlign: 'center',
                color: '#f3e9ff',
                background: '#0a0512',
                fontFamily: 'system-ui, sans-serif',
            }}
        >
            <h1 style={{ margin: 0 }}>🌸 Kei</h1>
            <p style={{ margin: 0, maxWidth: '32rem', lineHeight: 1.6 }}>{message}</p>
            <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                    padding: '0.6rem 1.4rem',
                    borderRadius: '999px',
                    border: '1px solid #b98cff',
                    background: 'rgba(185, 140, 255, 0.15)',
                    color: 'inherit',
                    cursor: 'pointer',
                }}
            >
                Thử lại
            </button>
        </div>
    );
}
