import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel, config as live2dConfig } from 'pixi-live2d-display/cubism4';
import { EMOTION_META, EMOTION_POSES, NEUTRAL_POSE } from '../lib/emotion';
import type { EmotionPose } from '../lib/emotion';
import { loadCubismCore } from '../lib/live2dCore';
import { mouthState } from '../lib/lipsync';
import type { Emotion, WaifuSettings } from '../lib/types';
import { clamp } from '../lib/utils';
import { waifuBus } from '../lib/waifuBus';
import SakuraLayer from './SakuraLayer';

// `pixi-live2d-display` cần PIXI toàn cục để đăng ký ticker & plugin âm thanh.
declare global {
    interface Window {
        PIXI: typeof PIXI;
    }
}
window.PIXI = PIXI;

// Model kei_vowels_pro gắn kèm file thoại thật (en/jp/ko/zh) cho TỪNG motion.
// Mặc định TẮT để Kei không tự lẩm bẩm mỗi khi rảnh; chỉ bật trong lúc phát
// "giọng mẫu" theo yêu cầu (nút 🎤) rồi tắt lại ngay.
live2dConfig.sound = false;

/* ==========================================================================
   Kiểu dữ liệu nội bộ cho core model Cubism 4
   ========================================================================== */

interface CoreModelLike {
    setParameterValueById(id: string, value: number, weight?: number): void;
    addParameterValueById(id: string, value: number, weight?: number): void;
    getParameterValueById(id: string, defaultValue?: number): number;
}

interface InternalModelLike {
    coreModel: CoreModelLike;
    /** Kích thước canvas gốc của model (chưa nhân scale). */
    width: number;
    height: number;
    getDrawableIDs(): string[];
    getDrawableVertices(index: number | string): Float32Array;
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
}

/** Hộp bao thật của phần hình vẽ (bỏ qua khoảng trong suốt quanh nhân vật). */
interface ArtBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface HeartParticle {
    id: number;
    x: number;
    y: number;
    emoji: string;
    delay: number;
    drift: number;
    size: number;
}

const MODEL_URL = '/models/kei_vowels_pro.model3.json';
const CLICK_SFX = '/models/sounds/miracle333-ara-ara-sound-effect-127279.mp3';
const MOTION_GROUP = ''; // Model kei chỉ có một nhóm motion với tên rỗng.
const MOTION_COUNT = 4;

/**
 * Motion dùng để phát "giọng mẫu". Model có 4 motion là CÙNG một động tác mắt,
 * chỉ khác file thoại đính kèm: 0 = en, 1 = jp, 2 = ko, 3 = zh.
 *
 * Tạm cố định JP (nghe hay nhất). Sau này muốn đổi theo ngôn ngữ đang chọn thì
 * thay hằng số này bằng một map `language -> index`.
 */
const SAMPLE_VOICE_MOTION = 1; // JP
const MOBILE_BREAKPOINT = 900;

const IDLE_EMOTES: Emotion[] = ['happy', 'thinking', 'neutral', 'shy'];
const PAT_EMOTES: Emotion[] = ['shy', 'happy', 'surprised', 'love'];

/**
 * Quét toàn bộ drawable để tìm vùng mà nhân vật thực sự chiếm chỗ.
 * Nhờ vậy Kei luôn được canh khung theo thân người thật, không bị lệch vì viền trong suốt.
 */
function measureArtBounds(internalModel: InternalModelLike): ArtBounds | null {
    try {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const id of internalModel.getDrawableIDs()) {
            let vertices: Float32Array;
            try {
                vertices = internalModel.getDrawableVertices(id);
            } catch {
                continue;
            }
            for (let i = 0; i < vertices.length; i += 2) {
                if (vertices[i] < minX) minX = vertices[i];
                if (vertices[i] > maxX) maxX = vertices[i];
                if (vertices[i + 1] < minY) minY = vertices[i + 1];
                if (vertices[i + 1] > maxY) maxY = vertices[i + 1];
            }
        }

        return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    } catch {
        return null;
    }
}

/**
 * Tạo PIXI Application với cơ chế thử lại.
 *
 * Khi lập trình với HMR, component bị unmount/mount liên tục và trình duyệt có thể
 * chưa kịp giải phóng WebGL context cũ → tạo context mới sẽ thất bại tạm thời.
 * Thử lại vài lần giúp trải nghiệm dev không bị "vỡ hình".
 */
async function createApplication(): Promise<PIXI.Application> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return new PIXI.Application({
                resizeTo: window,
                autoDensity: true,
                antialias: true,
                backgroundAlpha: 0,
                resolution: Math.min(2, window.devicePixelRatio || 1),
            });
        } catch (error) {
            lastError = error;
            await new Promise(resolve => window.setTimeout(resolve, 260 * (attempt + 1)));
        }
    }

    throw lastError;
}

interface WaifuProps {
    settings: WaifuSettings;
    affection: number;
}

/**
 * 🌸 Kei — nhân vật Live2D.
 *
 * Các "giác quan" được cài ở đây:
 *  • Mắt dõi theo con trỏ chuột; chớp mắt & thở do thư viện lo tự động.
 *  • Khuôn mặt đổi theo cảm xúc câu trả lời (má ửng, mắt cong, lông mày, nghiêng đầu).
 *  • Nhép miệng theo giọng đọc TTS với đúng khẩu hình nguyên âm A/I/U/E/O.
 *  • Được xoa đầu thì ngại ngùng, tim bay lên, phát motion + âm thanh.
 *  • Khi rảnh thì tự chơi motion ngẫu nhiên và liếc nhìn quanh.
 */
export default function Waifu({ settings, affection }: WaifuProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);
    const sfxRef = useRef<HTMLAudioElement | null>(null);
    const emoteTimeoutRef = useRef<number | null>(null);
    const headPointRef = useRef({ x: 0, y: 0 });

    const settingsRef = useRef(settings);
    const affectionRef = useRef(affection);

    /** Đồng bộ props mới nhất vào ref để các callback/handler không dùng giá trị cũ. */
    useEffect(() => {
        settingsRef.current = settings;
        affectionRef.current = affection;
    }, [settings, affection]);

    /** Tư thế khuôn mặt hiện tại + mục tiêu (nội suy mỗi frame cho mượt). */
    const poseRef = useRef<{ now: EmotionPose; target: EmotionPose; mouth: number }>({
        now: { ...NEUTRAL_POSE },
        target: { ...NEUTRAL_POSE },
        mouth: 0,
    });

    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const [errorText, setErrorText] = useState('');
    const [thinking, setThinking] = useState(false);
    const [headPoint, setHeadPoint] = useState({ x: 0, y: 0 });
    const [bubble, setBubble] = useState<{
        key: number;
        emoji: string;
        accent: string;
        label: string;
    } | null>(null);
    const [hearts, setHearts] = useState<HeartParticle[]>([]);

    useEffect(() => {
        headPointRef.current = headPoint;
    }, [headPoint]);

    /* ----------------------------- Tiện ích nội bộ ---------------------------- */

    const burstHearts = useCallback((emoji: string, count: number) => {
        const point = headPointRef.current;
        const particles: HeartParticle[] = Array.from({ length: count }, (_, index) => ({
            id: Date.now() + index + Math.random(),
            x: point.x + (Math.random() - 0.5) * 140,
            y: point.y + (Math.random() - 0.5) * 40,
            emoji,
            delay: index * 70,
            drift: (Math.random() - 0.5) * 80,
            size: 18 + Math.random() * 16,
        }));

        setHearts(current => [...current, ...particles]);
        window.setTimeout(() => {
            const ids = new Set(particles.map(p => p.id));
            setHearts(current => current.filter(item => !ids.has(item.id)));
        }, 2400);
    }, []);

    const showBubble = useCallback((emotion: Emotion, durationMs: number) => {
        const meta = EMOTION_META[emotion];
        setBubble({ key: Date.now(), emoji: meta.emoji, accent: meta.accent, label: meta.label });
        if (emoteTimeoutRef.current !== null) window.clearTimeout(emoteTimeoutRef.current);
        emoteTimeoutRef.current = window.setTimeout(() => setBubble(null), durationMs);
    }, []);

    const setEmotion = useCallback(
        (emotion: Emotion, withBubble = true) => {
            poseRef.current.target = { ...EMOTION_POSES[emotion] };
            if (withBubble) showBubble(emotion, 3400);
        },
        [showBubble],
    );

    const playMotion = useCallback((index?: number) => {
        const model = modelRef.current;
        if (!model) return;
        void model.motion(MOTION_GROUP, index);
    }, []);

    /**
     * Phát "giọng Kei" thật: tạm bật âm thanh của model để phát file thoại (.wav)
     * gắn với motion, rồi tắt lại ngay khi thư viện đã tạo xong audio (tránh Kei
     * tự lẩm bẩm khi rảnh).
     */
    const playSampleVoice = useCallback((index: number = SAMPLE_VOICE_MOTION) => {
        const model = modelRef.current;
        if (!model) return;
        live2dConfig.sound = true;
        void model.motion(MOTION_GROUP, index).finally(() => {
            live2dConfig.sound = false;
        });
    }, []);

    /** Dừng giọng đang phát (nếu có). */
    const stopSampleVoice = useCallback(() => {
        const model = modelRef.current;
        if (!model) return;
        const manager = (
            model.internalModel as unknown as { motionManager?: { stopAllMotions?: () => void } }
        ).motionManager;
        manager?.stopAllMotions?.();
    }, []);

    const playPatSound = useCallback(() => {
        if (!settingsRef.current.sfxEnabled) return;
        if (!sfxRef.current) {
            sfxRef.current = new Audio(CLICK_SFX);
            sfxRef.current.volume = 0.35;
            sfxRef.current.preload = 'auto';
        }
        const audio = sfxRef.current;
        audio.currentTime = 0;
        void audio.play().catch(() => undefined);
    }, []);

    /** Phản ứng khi người dùng chạm / xoa đầu Kei. */
    const reactToPat = useCallback(
        (source: 'hit' | 'click') => {
            const close = affectionRef.current >= 60;
            const emotion = PAT_EMOTES[Math.floor(Math.random() * PAT_EMOTES.length)];
            setEmotion(emotion);
            burstHearts(close ? '💗' : '✨', close ? 8 : 4);
            playPatSound();
            if (!mouthState.active) playMotion(Math.floor(Math.random() * MOTION_COUNT));
            waifuBus.emit('pat', { source });
        },
        [burstHearts, playMotion, playPatSound, setEmotion],
    );

    /* ------------------------ Khởi tạo PIXI + Live2D ------------------------- */

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        let disposed = false;
        let app: PIXI.Application | null = null;
        let teardown: (() => void) | null = null;

        const bootstrap = async () => {
            // Cubism Core phải sẵn sàng trước khi tạo model: ưu tiên bản local,
            // tự động fallback sang các CDN nếu thiếu file.
            await loadCubismCore();

            app = await createApplication();
            if (disposed) {
                app.destroy(true);
                return;
            }

            appRef.current = app;
            const view = app.view as HTMLCanvasElement;
            view.className = 'waifu-canvas';
            view.setAttribute('aria-label', 'Kei — nhân vật Live2D');
            host.appendChild(view);

            const model = await Live2DModel.from(MODEL_URL, { autoInteract: false, autoUpdate: true });
            if (disposed) {
                model.destroy();
                return;
            }

            modelRef.current = model;
            app.stage.addChild(model as unknown as PIXI.DisplayObject);
            model.anchor.set(0.5, 1);

            const internalModel = model.internalModel as unknown as InternalModelLike;
            const coreModel = internalModel.coreModel;

            /* ---------------------- Căn vị trí & kích thước ---------------------- */

            const art = measureArtBounds(internalModel);
            // Gốc toạ độ (pivot) mà `anchor` tạo ra, tính theo đơn vị gốc của model.
            const pivotX = model.anchor.x * internalModel.width;
            const pivotY = model.anchor.y * internalModel.height;

            const fit = () => {
                if (disposed || !app) return;
                const width = app.renderer.screen.width;
                const height = app.renderer.screen.height;
                const isMobile = width < MOBILE_BREAKPOINT;

                // Hộp bao hình vẽ (fallback về canvas gốc nếu không đo được).
                const box = art ?? {
                    minX: 0,
                    minY: 0,
                    maxX: internalModel.width,
                    maxY: internalModel.height,
                };
                const artWidth = Math.max(1, box.maxX - box.minX);
                const artHeight = Math.max(1, box.maxY - box.minY);

                // Chừa chỗ cho thanh tiêu đề + bong bóng cảm xúc ở trên đầu Kei.
                const top = height * (isMobile ? 0.05 : 0.07);
                const availableHeight = isMobile ? height * 0.55 : height - top - height * 0.02;
                const availableWidth = width * (isMobile ? 0.9 : 0.52);

                const scale = Math.min(availableHeight / artHeight, availableWidth / artWidth);
                model.scale.set(scale);

                // Trên desktop Kei đứng lệch phải để nhường chỗ cho khung chat.
                const artCenterX = (box.minX + box.maxX) / 2;
                const centerX = width * (isMobile ? 0.5 : 0.72);
                model.position.set(
                    centerX - (artCenterX - pivotX) * scale,
                    top - (box.minY - pivotY) * scale,
                );

                setHeadPoint({ x: centerX, y: top + (isMobile ? 2 : 6) });
            };

            fit();
            setStatus('ready');

            // Hook gỡ lỗi khi chạy `npm run dev` (giúp tinh chỉnh vị trí/tỉ lệ model).
            if (import.meta.env.DEV) {
                (window as unknown as { __keiDebug?: unknown }).__keiDebug = { app, model, coreModel, fit };
            }

            /* -------------------------- Vòng lặp khuôn mặt ------------------------- */

            const applyFrame = () => {
                const state = poseRef.current;
                const lerp = (from: number, to: number, alpha: number) => from + (to - from) * alpha;
                const alpha = 0.09;

                state.now.cheek = lerp(state.now.cheek, state.target.cheek, alpha);
                state.now.eyeSmile = lerp(state.now.eyeSmile, state.target.eyeSmile, alpha);
                state.now.eyeOpen = lerp(state.now.eyeOpen, state.target.eyeOpen, alpha);
                state.now.browY = lerp(state.now.browY, state.target.browY, alpha);
                state.now.browForm = lerp(state.now.browForm, state.target.browForm, alpha);
                state.now.headTilt = lerp(state.now.headTilt, state.target.headTilt, alpha);
                state.now.headPitch = lerp(state.now.headPitch, state.target.headPitch, alpha);

                const pose = state.now;

                coreModel.setParameterValueById('ParamCheek', pose.cheek);
                coreModel.setParameterValueById('ParamEyeLSmile', pose.eyeSmile);
                coreModel.setParameterValueById('ParamEyeRSmile', pose.eyeSmile);
                coreModel.setParameterValueById('ParamBrowLY', pose.browY);
                coreModel.setParameterValueById('ParamBrowRY', pose.browY);
                coreModel.setParameterValueById('ParamBrowLForm', pose.browForm);
                coreModel.setParameterValueById('ParamBrowRForm', pose.browForm);

                // Nhân thay vì ghi đè → giữ nguyên hiệu ứng chớp mắt tự động của thư viện.
                const openLeft = coreModel.getParameterValueById('ParamEyeLOpen', 1);
                const openRight = coreModel.getParameterValueById('ParamEyeROpen', 1);
                coreModel.setParameterValueById('ParamEyeLOpen', clamp(openLeft * pose.eyeOpen, 0, 1.4));
                coreModel.setParameterValueById('ParamEyeROpen', clamp(openRight * pose.eyeOpen, 0, 1.4));

                // Nghiêng / ngẩng đầu: cộng thêm để không phá chuyển động tự nhiên.
                coreModel.addParameterValueById('ParamAngleZ', pose.headTilt * 0.6);
                coreModel.addParameterValueById('ParamAngleY', pose.headPitch * 8);

                /* --------------------------- Nhép miệng TTS --------------------------- */

                const mouthTarget = mouthState.active ? mouthState.open : 0;
                state.mouth = lerp(state.mouth, mouthTarget, mouthState.active ? 0.5 : 0.2);

                if (mouthState.active || state.mouth > 0.02) {
                    coreModel.setParameterValueById('ParamMouthOpenY', clamp(state.mouth, 0, 1));
                    const vowels = ['A', 'I', 'U', 'E', 'O'] as const;
                    const activeVowel = mouthState.active ? mouthState.shape : 'A';
                    for (const vowel of vowels) {
                        const value = mouthState.active && vowel === activeVowel ? clamp(state.mouth * 0.9, 0, 1) : 0;
                        coreModel.setParameterValueById(`Param${vowel}`, value);
                    }
                }
            };

            internalModel.on('beforeModelUpdate', applyFrame);

            /* ---------------------------- Giác quan khác --------------------------- */

            const onPointerMove = (event: PointerEvent) => {
                model.focus(event.clientX, event.clientY);
            };

            const onPointerDown = (event: PointerEvent) => {
                const hitAreas = model.hitTest(event.clientX, event.clientY);
                if (hitAreas.length) {
                    reactToPat('hit');
                    return;
                }
                const bounds = model.getBounds();
                const inside =
                    event.clientX >= bounds.x &&
                    event.clientX <= bounds.x + bounds.width &&
                    event.clientY >= bounds.y &&
                    event.clientY <= bounds.y + bounds.height;
                if (inside) reactToPat('click');
            };

            const onResize = () => fit();

            window.addEventListener('pointermove', onPointerMove, { passive: true });
            view.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('resize', onResize);
            window.addEventListener('orientationchange', onResize);

            // ResizeObserver bắt được cả những thay đổi layout mà sự kiện `resize`
            // của window bỏ sót (xoay màn hình, thanh địa chỉ trên mobile, devtools...).
            const resizeObserver = new ResizeObserver(() => fit());
            resizeObserver.observe(view);

            teardown = () => {
                window.removeEventListener('pointermove', onPointerMove);
                view.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('resize', onResize);
                window.removeEventListener('orientationchange', onResize);
                resizeObserver.disconnect();
                internalModel.off('beforeModelUpdate', applyFrame);
            };
        };

        void bootstrap().catch((error: unknown) => {
            console.warn('[Kei] Không tải được model Live2D:', error);
            setStatus('error');
            setErrorText(
                error instanceof Error && error.message.includes('Cubism Core')
                    ? error.message
                    : 'Không tải được model Live2D. Kiểm tra thư mục public/models rồi tải lại trang nhé.',
            );
        });

        return () => {
            disposed = true;
            teardown?.();
            if (emoteTimeoutRef.current !== null) window.clearTimeout(emoteTimeoutRef.current);

            const instance = appRef.current;
            modelRef.current = null;
            appRef.current = null;

            if (instance) {
                const view = instance.view as HTMLCanvasElement;
                try {
                    instance.destroy(true, { children: true });
                } catch (error) {
                    console.warn('[Kei] Bỏ qua lỗi khi huỷ PIXI:', error);
                }
                view.remove();
            }
        };
    }, [reactToPat]);

    /* ------------------------------ Lắng nghe bus ---------------------------- */

    useEffect(() => {
        const offEmote = waifuBus.on('emote', ({ emotion, durationMs }) => {
            setEmotion(emotion);
            if (emotion === 'love' || emotion === 'shy') burstHearts('💗', 5);
            if (emotion === 'surprised') burstHearts('❗', 2);

            if (durationMs) {
                if (emoteTimeoutRef.current !== null) window.clearTimeout(emoteTimeoutRef.current);
                emoteTimeoutRef.current = window.setTimeout(() => {
                    poseRef.current.target = { ...NEUTRAL_POSE };
                }, durationMs);
            }
        });

        const offThinking = waifuBus.on('thinking', ({ active }) => {
            setThinking(active);
            if (active) poseRef.current.target = { ...EMOTION_POSES.thinking };
        });

        const offAffection = waifuBus.on('affectionUp', ({ delta }) => {
            if (delta > 0) burstHearts('✨', 3);
        });

        // "Giọng Kei" = file thoại .wav của model (không phải TTS).
        const offSampleVoice = waifuBus.on('sampleVoice', ({ index }) => {
            playSampleVoice(index);
        });
        const offStopVoice = waifuBus.on('stopVoice', () => {
            stopSampleVoice();
        });

        return () => {
            offEmote();
            offThinking();
            offAffection();
            offSampleVoice();
            offStopVoice();
        };
    }, [burstHearts, setEmotion, playSampleVoice, stopSampleVoice]);

    /* -------------------- Motion & liếc mắt khi rảnh rỗi --------------------- */

    useEffect(() => {
        if (status !== 'ready' || !settings.autoMotion) return;

        const motionTimer = window.setInterval(() => {
            if (mouthState.active) return; // Đang đọc TTS thì không chồng motion.
            if (Math.random() < 0.55) {
                playMotion();
                return;
            }
            const emotion = IDLE_EMOTES[Math.floor(Math.random() * IDLE_EMOTES.length)];
            poseRef.current.target = { ...EMOTION_POSES[emotion] };
            window.setTimeout(() => {
                poseRef.current.target = { ...NEUTRAL_POSE };
            }, 4200);
        }, 26_000);

        let glanceCount = 0;
        const glanceTimer = window.setInterval(() => {
            const model = modelRef.current;
            if (!model || mouthState.active) return;
            glanceCount += 1;

            const width = window.innerWidth;
            const height = window.innerHeight;
            model.focus(
                width / 2 + (Math.random() - 0.5) * width * 0.35,
                height / 2 + (Math.random() - 0.35) * height * 0.3,
            );

            if (glanceCount % 3 === 0 && Math.random() < 0.4) {
                poseRef.current.target = { ...EMOTION_POSES.happy };
                window.setTimeout(() => {
                    poseRef.current.target = { ...NEUTRAL_POSE };
                }, 3000);
            }
        }, 9000);

        return () => {
            window.clearInterval(motionTimer);
            window.clearInterval(glanceTimer);
        };
    }, [status, settings.autoMotion, playMotion]);

    /* -------------------------------- Giao diện ------------------------------ */

    const bubbleStyle = {
        left: headPoint.x,
        top: Math.max(80, headPoint.y),
        '--bubble-accent': bubble?.accent ?? '#8be9fd',
    } as CSSProperties;

    return (
        <>
            <div ref={hostRef} className="waifu-canvas-host" />

            {settings.petals && <SakuraLayer />}

            {/* Bong bóng cảm xúc / suy nghĩ trên đầu Kei */}
            <div className="waifu-bubble-layer" aria-hidden="true">
                {thinking ? (
                    <div className="waifu-bubble waifu-bubble--thinking" style={bubbleStyle}>
                        <span className="dot" />
                        <span className="dot" />
                        <span className="dot" />
                    </div>
                ) : bubble ? (
                    <div key={bubble.key} className="waifu-bubble waifu-bubble--emote" style={bubbleStyle}>
                        <span className="waifu-bubble__emoji">{bubble.emoji}</span>
                        <span className="waifu-bubble__label">{bubble.label}</span>
                    </div>
                ) : null}
            </div>

            {/* Tim bay lên khi được xoa đầu */}
            <div className="waifu-heart-layer" aria-hidden="true">
                {hearts.map(heart => (
                    <span
                        key={heart.id}
                        className="waifu-heart"
                        style={
                            {
                                left: heart.x,
                                top: heart.y,
                                fontSize: heart.size,
                                animationDelay: `${heart.delay}ms`,
                                '--heart-drift': `${heart.drift}px`,
                            } as CSSProperties
                        }
                    >
                        {heart.emoji}
                    </span>
                ))}
            </div>

            {status === 'ready' && (
                <div className="waifu-controls">
                    <button
                        type="button"
                        className="waifu-control"
                        title="Xoa đầu Kei ♡"
                        onClick={() => reactToPat('click')}
                    >
                        💗
                    </button>
                    <button
                        type="button"
                        className="waifu-control"
                        title="Nghe giọng mẫu của Kei"
                        onClick={() => {
                            setEmotion('happy');
                            playSampleVoice();
                        }}
                    >
                        🎤
                    </button>
                    <button
                        type="button"
                        className="waifu-control"
                        title="Vẫy tay chào"
                        onClick={() => {
                            setEmotion('happy');
                            burstHearts('✨', 4);
                            playMotion(0);
                        }}
                    >
                        👋
                    </button>
                </div>
            )}

            {status === 'loading' && (
                <div className="waifu-status">
                    <div className="waifu-status__spinner" />
                    <p>Đang đánh thức Kei…</p>
                </div>
            )}

            {status === 'error' && (
                <div className="waifu-status waifu-status--error">
                    <p>{errorText}</p>
                </div>
            )}
        </>
    );
}
