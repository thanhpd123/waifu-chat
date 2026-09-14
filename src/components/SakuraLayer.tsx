import { useEffect, useRef } from 'react';

interface Petal {
    x: number;
    y: number;
    size: number;
    speed: number;
    sway: number;
    phase: number;
    spin: number;
    angle: number;
    alpha: number;
}

const COLORS = ['#ffc2dd', '#ff9ec7', '#ffd7e8', '#ffb3d1'];

/**
 * Lớp cánh hoa anh đào rơi — vẽ bằng Canvas 2D cho nhẹ (không đụng tới WebGL của Live2D).
 * Tự tắt khi người dùng bật "giảm chuyển động" trong hệ điều hành.
 */
export default function SakuraLayer() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        let raf = 0;
        let width = 0;
        let height = 0;
        let petals: Petal[] = [];

        const spawn = (initial: boolean): Petal => ({
            x: Math.random() * width,
            y: initial ? Math.random() * height : -20,
            size: 6 + Math.random() * 8,
            speed: 14 + Math.random() * 26,
            sway: 18 + Math.random() * 34,
            phase: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 1.6,
            angle: Math.random() * Math.PI * 2,
            alpha: 0.35 + Math.random() * 0.45,
        });

        const resize = () => {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const count = width < 900 ? 14 : 30;
            petals = Array.from({ length: count }, () => spawn(true));
        };

        resize();
        window.addEventListener('resize', resize);

        let last = performance.now();
        const draw = (now: number) => {
            const delta = Math.min(48, now - last) / 1000;
            last = now;

            ctx.clearRect(0, 0, width, height);

            for (let index = 0; index < petals.length; index += 1) {
                const petal = petals[index];
                petal.y += petal.speed * delta;
                petal.phase += delta * 1.4;
                petal.angle += petal.spin * delta;
                const x = petal.x + Math.sin(petal.phase) * petal.sway;

                if (petal.y > height + 30) petals[index] = spawn(false);

                ctx.save();
                ctx.translate(x, petal.y);
                ctx.rotate(petal.angle);
                ctx.globalAlpha = petal.alpha;
                ctx.fillStyle = COLORS[index % COLORS.length];
                ctx.beginPath();
                ctx.ellipse(0, 0, petal.size, petal.size * 0.55, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            raf = window.requestAnimationFrame(draw);
        };

        raf = window.requestAnimationFrame(draw);

        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return <canvas ref={canvasRef} className="sakura-layer" aria-hidden="true" />;
}
