import { useEffect, useRef } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4'; // dùng cubism4

// Expose PIXI cho ticker auto (từ tài liệu)
declare global {
    interface Window { PIXI: typeof PIXI }
}
window.PIXI = PIXI;

export default function Waifu() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const modelRef = useRef<Live2DModel | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        let app: PIXI.Application | null = null;
        (async () => {
            app = new PIXI.Application({
                view: canvasRef.current || undefined,
                resizeTo: window,
                autoStart: true,
                backgroundAlpha: 1, // Nền trong suốt (tuỳ chọn)
            });
            appRef.current = app;
            // Load model từ file json (tài liệu: Live2DModel.from(source))
            const model = await Live2DModel.from('/models/kei_vowels_pro.model3.json');
            modelRef.current = model;

            // Add model to stage; cast to DisplayObject to satisfy Pixi typings
            app!.stage.addChild(model as unknown as PIXI.DisplayObject);

            // Transforms từ tài liệu: position, scale, rotation, skew, anchor
            model.x = window.innerWidth / 2;
            model.y = window.innerHeight / 2;
            model.scale.set(0.4, 0.4); // tăng scale để dễ thấy hơn
            // Một số phiên bản không có anchor, dùng pivot để căn giữa
            if ((model as unknown as { anchor?: { set: (x: number, y: number) => void } }).anchor) {
                (model as unknown as { anchor: { set: (x: number, y: number) => void } }).anchor.set(0.5, 0.5);
            } else {
                model.pivot.set(model.width / 2, model.height / 2);
            }
            model.rotation = 0; // có thể quay nếu muốn
            model.skew.set(0, 0); // skew nếu cần distort

            // Motion: auto idle nếu khả dụng
            type MotionCapable = { motion?: (group: string, index?: number) => void };
            const mc = model as unknown as MotionCapable;
            if (typeof mc.motion === 'function') {
                mc.motion('idle');
            }

            // Interaction: on('hit') (từ tài liệu)
            // Temporarily disable interaction to isolate model rendering
            app.stage.interactiveChildren = false;

            // Responsive resize
            const resize = () => {
                if (!app) return;
                app.renderer.resize(window.innerWidth, window.innerHeight);
                model.x = window.innerWidth / 2;
                model.y = window.innerHeight / 2;
            };
            // Trigger initial resize for correct sizing
            resize();
            window.addEventListener('resize', resize);
            return () => window.removeEventListener('resize', resize);
        })();

        return () => {
            const instance = appRef.current;
            if (instance && typeof instance.destroy === 'function') {
                try {
                    instance.destroy();
                } catch (e) {
                    // v8 ResizePlugin may throw if not fully initialized; ignore in cleanup
                    console.warn('Pixi Application destroy warning:', e);
                }
            }
            appRef.current = null;
            app = null;
        };
    }, []);

    return (
        <>
            <button
                onClick={() => {
                    const model = modelRef.current;
                    if (!model) return;
                    // Try play motion (if it auto-handles audio via motion file)
                    const m = model as unknown as { motion?: (group: string, index?: number) => void };
                    if (typeof m.motion === 'function') {
                        m.motion('', 0);
                    }
                    // Drive mouth via WebAudio from external wav
                    const audio = new Audio('/models/sounds/01_kei_en.wav');
                    audio.crossOrigin = 'anonymous';
                    audio.play().catch(() => {/* ignore */ });
                    // Attach simple lipsync using audio volume → ParamMouthOpenY
                    try {
                        const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
                            || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
                        if (!AC) return;
                        const ctx = new AC();
                        const source = ctx.createMediaElementSource(audio);
                        const analyser = ctx.createAnalyser();
                        analyser.fftSize = 512;
                        source.connect(analyser);
                        analyser.connect(ctx.destination);
                        const data = new Uint8Array(analyser.frequencyBinCount);
                        let rafId = 0;
                        const update = () => {
                            analyser.getByteFrequencyData(data);
                            let sum = 0;
                            for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
                            const rms = Math.sqrt(sum / data.length);
                            const open = Math.min(1, rms / 128); // normalize roughly 0-1
                            try {
                                const internalModel = (modelRef.current as unknown as { internalModel?: { coreModel?: { setParameterValueById: (id: string, v: number) => void } } }).internalModel;
                                const core = internalModel?.coreModel;
                                if (core) {
                                    core.setParameterValueById('ParamMouthOpenY', open);
                                    core.setParameterValueById('ParamA', 0);
                                    core.setParameterValueById('ParamI', 0);
                                    core.setParameterValueById('ParamU', 0);
                                    core.setParameterValueById('ParamE', 0);
                                    core.setParameterValueById('ParamO', 0);
                                }
                            } catch {
                                // ignore per-frame errors
                            }
                            rafId = requestAnimationFrame(update);
                        };
                        update();
                        const cleanup = () => {
                            cancelAnimationFrame(rafId);
                            try {
                                const internalModel = (modelRef.current as unknown as { internalModel?: { coreModel?: { setParameterValueById: (id: string, v: number) => void } } }).internalModel;
                                internalModel?.coreModel?.setParameterValueById('ParamMouthOpenY', 0);
                            } catch {
                                // ignore reset errors
                            }
                            try { source.disconnect(); } catch { /* ignore */ }
                            try { analyser.disconnect(); } catch { /* ignore */ }
                            try { ctx.close(); } catch { /* ignore */ }
                            audio.removeEventListener('ended', cleanup);
                            audio.removeEventListener('pause', cleanup);
                        };
                        audio.addEventListener('ended', cleanup);
                        audio.addEventListener('pause', cleanup);
                    } catch {
                        // WebAudio init failed; ignore
                    }
                }}
                style={{
                    position: 'fixed',
                    top: 12,
                    right: 12,
                    zIndex: 3,
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: 'none',
                    background: '#ff79c6',
                    color: '#000',
                    fontWeight: 600,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
                }}
                title="Nói chuyện (EN)"
            >
                Nói chuyện ♡
            </button>
            <canvas
                ref={canvasRef}
                style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }}
            />
        </>
    );
}