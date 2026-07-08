import { useState, useRef, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------
   ハミュレーション — ホワイトニングシミュレーター (Phase 0 / v4)
   - デザイン: ゴールド×アイボリー / 見出しShippori Mincho
   - TOP: ヒーロー(コピー+画像) + 使い方3ステップ + クリニック(ダミー)
   - シミュレーター: 画像アップロード or インカメラ → 歯の色調補正
   - 方式(オフィス/ホーム/セルフ) × 回数 で白さが変化
   - Before/After スライダー + シェードガイド表示
   ------------------------------------------------------------------ */

/* 画像アセット(public/ 直下)。空文字にするとフォールバック表示 */
const LOGO_SRC = "/logo.png";
const HERO_SRC = "/hero.jpg";
const METHOD_ICONS = { office: "/method1.png", home: "/method2.png", self: "/method3.png" };

const C = {
  bg: "#FAF7F1",
  card: "#FFFFFF",
  ink: "#2B241A",
  sub: "#8B8171",
  gold: "#C0913C",
  goldDark: "#A67B2E",
  goldLight: "#E6C87E",
  champagne: "#F7EFDD",
  line: "#EDE5D6",
};

const SERIF = "'Shippori Mincho','Hiragino Mincho ProN',serif";

const SHADES = [
  { name: "A4", hex: "#C9A57B" },
  { name: "A3.5", hex: "#D3B189" },
  { name: "A3", hex: "#DCBD97" },
  { name: "A2", hex: "#E5CBA8" },
  { name: "A1", hex: "#EEDBBC" },
  { name: "B2", hex: "#F0E0C4" },
  { name: "B1", hex: "#F5EAD3" },
  { name: "BL", hex: "#FAF3E3" },
];

const METHODS = [
  { id: "office", label: "オフィス", desc: "歯科医院で施術", perSession: 0.30 },
  { id: "home", label: "ホーム", desc: "自宅でマウスピース", perSession: 0.17 },
  { id: "self", label: "セルフ", desc: "サロンで自分で照射", perSession: 0.11 },
];

const CLINICS = [
  { name: "表参道ホワイトニングデンタル", area: "渋谷区・表参道", tag: "オフィス", price: "¥16,500〜", rating: 4.7, note: "駅徒歩3分 / 平日21時まで" },
  { name: "銀座スマイルホワイトニング", area: "中央区・銀座", tag: "セルフ", price: "¥4,980〜", rating: 4.5, note: "初回半額 / 当日予約OK" },
  { name: "新宿中央歯科クリニック", area: "新宿区・新宿三丁目", tag: "ホーム", price: "¥27,500〜", rating: 4.6, note: "マウスピース即日作成" },
  { name: "池袋ホワイトデンタルオフィス", area: "豊島区・池袋", tag: "オフィス", price: "¥19,800〜", rating: 4.4, note: "土日診療 / 夜間対応" },
];

const HOWTO_STEPS = [
  { img: "/step1.jpg", title: "笑顔の写真を用意", desc: "歯が見える笑顔の写真をアップロード、またはインカメラでそのまま撮影。" },
  { img: "/step2.jpg", title: "口元を枠で指定", desc: "枠をドラッグして口元に合わせ、スライダーで大きさを調整。" },
  { img: "/step3.jpg", title: "白さをイメージ比較", desc: "方式と回数を選び、Before/Afterをスライダーで見比べ。" },
];

/* --- シェードガイド8色の帯(シグネチャー装飾) --- */
function ShadeStrip({ height = 5, radius = 999, style = {} }) {
  return (
    <div style={{ display: "flex", height, borderRadius: radius, overflow: "hidden", ...style }} aria-hidden="true">
      {SHADES.map((s) => (
        <div key={s.name} style={{ flex: 1, background: s.hex }} />
      ))}
    </div>
  );
}

/* --- 歯っぽいピクセルの判定(簡易ヒューリスティック) --- */
function toothMask(r, g, b) {
  const brightness = (r + g + b) / 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  if (brightness < 95) return 0;
  if (sat > 85) return 0;
  if (b > r + 12) return 0; // 青すぎるものは除外
  if (g > r + 10) return 0; // 緑すぎるものは除外
  // 明るく低彩度なほど強くマスク
  const bw = Math.min(1, (brightness - 95) / 90);
  const sw = 1 - Math.min(1, sat / 85);
  return Math.min(1, bw * 0.6 + sw * 0.6);
}

function applyWhitening(src, dst, intensity, w, h, region) {
  const s = src.data;
  const d = dst.data;
  const cx = region.cx * w;
  const cy = region.cy * h;
  const rx = Math.max(8, region.r * w);
  const ry = Math.max(6, rx * 0.55);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = s[i], g = s[i + 1], b = s[i + 2];
      // 楕円の内側だけ処理(縁はなめらかにフェード)
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const dist = dx * dx + dy * dy;
      let area = 0;
      if (dist < 0.75) area = 1;
      else if (dist < 1.2) area = (1.2 - dist) / 0.45;
      const m = area > 0 ? toothMask(r, g, b) * intensity * area : 0;
      if (m > 0.01) {
        // 白方向へブレンド + 黄ばみ(青チャンネル不足)を補正
        d[i] = r + (255 - r) * m * 0.75;
        d[i + 1] = g + (255 - g) * m * 0.78;
        d[i + 2] = Math.min(255, b + (255 - b) * m * 0.95);
        d[i + 3] = s[i + 3];
      } else {
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = s[i + 3];
      }
    }
  }
}

export default function WhiteningSimulator() {
  const [screen, setScreen] = useState("home"); // home | sim
  const [imgSrc, setImgSrc] = useState(null);
  const [method, setMethod] = useState("office");
  const [sessions, setSessions] = useState(3);
  const [split, setSplit] = useState(0.5);
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState("");
  const [imgStatus, setImgStatus] = useState("");
  const [mouth, setMouth] = useState({ cx: 0.5, cy: 0.62, r: 0.16 }); // 口元エリア(相対座標)
  const [editMode, setEditMode] = useState("area"); // area(エリア調整) | compare(比較)
  const [showAreaNote, setShowAreaNote] = useState(false); // エリア選択の案内モーダル

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(false);

  const m = METHODS.find((x) => x.id === method);
  const intensity = Math.min(0.85, 1 - Math.pow(1 - m.perSession, sessions));
  const startShade = 2; // A3想定
  const shadeIdx = Math.min(SHADES.length - 1, startShade + Math.round(intensity * 7));

  /* --- 描画 --- */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    try {
    const maxW = 640;
    const scale = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const before = ctx.getImageData(0, 0, w, h);
    const after = ctx.createImageData(w, h);
    applyWhitening(before, after, intensity, w, h, mouth);
    // 左=Before / 右=After をスライダー位置で分割
    ctx.putImageData(before, 0, 0);
    const sx = Math.round(w * split);
    if (sx < w) {
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = h;
      tmp.getContext("2d").putImageData(after, 0, 0);
      ctx.drawImage(tmp, sx, 0, w - sx, h, sx, 0, w - sx, h);
    }
    // 分割線
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(sx - 1, 0, 2, h);
    // エリア調整モード時は楕円ガイドを表示
    if (editMode === "area") {
      ctx.save();
      ctx.strokeStyle = "#C0913C";
      ctx.lineWidth = Math.max(2, w / 240);
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.ellipse(mouth.cx * w, mouth.cy * h, Math.max(8, mouth.r * w), Math.max(6, mouth.r * w * 0.55), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    } catch (err) {
      setImgStatus("画像の処理中にエラーが発生しました。別の写真でお試しください。");
    }
  }, [intensity, split, mouth, editMode]);

  useEffect(() => { render(); }, [render, imgSrc]);

  /* --- 画像読み込み --- */
  const loadFile = (f) => {
    if (!f) return;
    setImgStatus("読み込み中…");
    const reader = new FileReader();
    reader.onerror = () => setImgStatus("ファイルを読み込めませんでした。別の写真でお試しください。");
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        setImgStatus("");
        stopCamera();
        setEditMode("area");
        setMouth({ cx: 0.5, cy: 0.62, r: 0.16 });
        setImgSrc(reader.result);
      };
      img.onerror = () =>
        setImgStatus("この画像形式を表示できませんでした(iPhoneのHEIC形式の可能性)。スクリーンショットを撮ってその画像を選ぶか、設定→カメラ→フォーマットを「互換性優先」にして撮影し直すと読み込めます。");
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    loadFile(f);
    e.target.value = ""; // 同じファイルの再選択を許可
  };

  /* --- カメラ --- */
  const startCamera = async () => {
    setCamError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" }, audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 50);
    } catch (err) {
      setCamError("カメラを起動できませんでした。画像アップロードをご利用ください。");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  const capture = () => {
    const v = videoRef.current;
    if (!v) return;
    const tmp = document.createElement("canvas");
    tmp.width = v.videoWidth;
    tmp.height = v.videoHeight;
    const ctx = tmp.getContext("2d");
    // インカメラは左右反転して保存
    ctx.translate(tmp.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    const url = tmp.toDataURL("image/jpeg", 0.92);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setEditMode("area");
      setMouth({ cx: 0.5, cy: 0.62, r: 0.16 });
      setImgSrc(url);
      stopCamera();
    };
    img.src = url;
  };

  useEffect(() => () => stopCamera(), []);

  /* --- キャンバス上のドラッグ操作(モード別) --- */
  const xyFromEvent = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0.5, y: 0.5 };
    const rect = canvas.getBoundingClientRect();
    const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return {
      x: Math.max(0.02, Math.min(0.98, px / rect.width)),
      y: Math.max(0.02, Math.min(0.98, py / rect.height)),
    };
  };
  const applyPointer = (e) => {
    const p = xyFromEvent(e);
    if (editMode === "area") setMouth((prev) => ({ ...prev, cx: p.x, cy: p.y }));
    else setSplit(p.x);
  };
  const onDown = (e) => { dragRef.current = true; applyPointer(e); };
  const onMove = (e) => { if (dragRef.current) applyPointer(e); };
  const onUp = () => { dragRef.current = false; };

  const goSim = () => { setScreen("sim"); window.scrollTo(0, 0); };

  /* ================= UI ================= */
  const font = { fontFamily: "'Zen Kaku Gothic New','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif" };

  return (
    <div style={{ ...font, background: C.bg, minHeight: "100vh", color: C.ink }}>
      <style>{`
        button { cursor: pointer; font-family: inherit; }
        button:focus-visible { outline: 3px solid ${C.goldLight}; outline-offset: 2px; }
        .hm-container { max-width: 1080px; margin: 0 auto; padding: 0 20px; }
        .hm-hero { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: center; padding: 16px 0 24px; }
        .hm-hero-img { display: none; }
        .hm-hero-img-mobile { display: block; }
        .hm-lead-pc { display: none; }
        .hm-steps { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .hm-clinics { display: grid; grid-template-columns: 1fr; gap: 12px; }
        .hm-step-card { transition: transform .18s ease; }
        .hm-cta { position: relative; overflow: hidden; }
        .hm-cta::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 42%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
          animation: hmShine 2.6s ease-in-out infinite; }
        .hm-sparkle { position: absolute; pointer-events: none; animation: hmFloat 2.8s ease-in-out infinite alternate; }
        @keyframes hmShine { 0% { transform: translateX(-130%) skewX(-20deg); } 55%, 100% { transform: translateX(280%) skewX(-20deg); } }
        @keyframes hmFloat { from { transform: translateY(0) rotate(-4deg); } to { transform: translateY(-9px) rotate(6deg); } }
        @media (min-width: 880px) {
          .hm-hero { grid-template-columns: 1.08fr 0.92fr; gap: 40px; padding: 26px 0 30px; }
          .hm-hero-img { display: block; }
          .hm-hero-img-mobile { display: none; }
          .hm-lead-pc { display: block; }
          .hm-steps { grid-template-columns: repeat(3, 1fr); gap: 14px; }
          .hm-clinics { grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .hm-step-card:hover { transform: translateY(-4px); }
        }
      `}</style>

      {/* ---------- ヘッダー(sticky) ---------- */}
      <header style={{ position: "sticky", top: 0, zIndex: 40, background: "rgba(250,247,241,0.92)", backdropFilter: "blur(8px)", borderBottom: `1px solid ${C.line}` }}>
        <div className="hm-container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {LOGO_SRC ? (
              <img src={LOGO_SRC} alt="ハミュレーション — 歯の未来をシミュレーション" style={{ height: 30, width: "auto", maxWidth: "62vw", display: "block", objectFit: "contain" }} />
            ) : (
              <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 20, letterSpacing: 1, color: C.gold }}>ハミュレーション</div>
            )}
          </div>
          <button
            onClick={() => setShowAreaNote(true)}
            style={{ fontSize: 11, background: C.champagne, color: C.goldDark, borderRadius: 999, padding: "7px 14px", fontWeight: 700, border: `1px solid ${C.goldLight}` }}
          >
            📍 エリアを選択
          </button>
        </div>
      </header>

      {screen === "home" && (
        <main>
          {/* ---------- ヒーロー(FV圧縮版) ---------- */}
          <div className="hm-container">
            <section className="hm-hero">
              <div style={{ position: "relative" }}>
                <img className="hm-sparkle" src="/favicon.png" alt="" aria-hidden="true" style={{ width: 22, top: -4, right: 8, opacity: 0.9 }} />
                <div style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, letterSpacing: 1.5, color: C.goldDark, background: C.champagne, border: `1px solid ${C.goldLight}`, borderRadius: 999, padding: "5px 12px", marginBottom: 12 }}>
                  歯のホワイトニング・シミュレーター
                </div>
                <h1 style={{ fontFamily: SERIF, fontSize: "clamp(25px, 3.4vw, 36px)", fontWeight: 600, lineHeight: 1.42, letterSpacing: 1, margin: "0 0 10px" }}>
                  白い歯の自分に、<br />ひと足先に会いにいく。
                </h1>
                <p className="hm-lead-pc" style={{ fontSize: 13.5, color: C.sub, lineHeight: 1.85, margin: "0 0 16px" }}>
                  あなたの写真で、ホワイトニング後の口元をその場でシミュレーション。<br />
                  方式と回数を選ぶだけで、仕上がりの白さをイメージできます。
                </p>
                <button
                  className="hm-cta"
                  onClick={goSim}
                  style={{
                    width: "100%", maxWidth: 400, border: "none",
                    background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`,
                    borderRadius: 999, padding: "17px 28px", color: "#fff",
                    fontWeight: 900, fontSize: 15.5, letterSpacing: 1, marginTop: 4,
                    boxShadow: "0 8px 24px rgba(192,145,60,0.4)",
                  }}
                >
                  ✨ 無料でシミュレーションする →
                </button>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10, maxWidth: 400 }}>
                  {["約30秒", "無料・登録不要", "写真は端末内処理", "アプリ不要"].map((t) => (
                    <span key={t} style={{ fontSize: 10.5, fontWeight: 700, color: C.sub, background: C.card, border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 10px" }}>✓ {t}</span>
                  ))}
                </div>
                {HERO_SRC && (
                  <div className="hm-hero-img-mobile" style={{ position: "relative", marginTop: 16 }}>
                    <img src={HERO_SRC} alt="ホワイトニングのイメージ" style={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", objectPosition: "center 30%", borderRadius: 18, display: "block", border: `1px solid ${C.line}` }} />
                    <img className="hm-sparkle" src="/favicon.png" alt="" aria-hidden="true" style={{ width: 20, top: -8, left: 14 }} />
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 400, marginTop: 14 }}>
                  <div style={{ flex: 1 }}><ShadeStrip /></div>
                  <span style={{ fontSize: 10.5, color: C.sub, fontWeight: 700, whiteSpace: "nowrap" }}>白さの目安をシェードで表示</span>
                </div>
              </div>
              {HERO_SRC && (
                <div className="hm-hero-img" style={{ position: "relative" }}>
                  <img src={HERO_SRC} alt="ホワイトニングのイメージ" style={{ width: "100%", aspectRatio: "5 / 4", objectFit: "cover", objectPosition: "center 32%", borderRadius: 22, display: "block", border: `1px solid ${C.line}`, boxShadow: "0 16px 40px rgba(43,36,26,0.12)" }} />
                  <img className="hm-sparkle" src="/favicon.png" alt="" aria-hidden="true" style={{ width: 30, top: -12, right: 26 }} />
                  <img className="hm-sparkle" src="/favicon.png" alt="" aria-hidden="true" style={{ width: 18, bottom: 44, right: -6, animationDelay: "1.2s" }} />
                  <div style={{ position: "absolute", left: 16, bottom: -14, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 14px", boxShadow: "0 8px 20px rgba(43,36,26,0.10)", width: 210 }}>
                    <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, color: C.gold, marginBottom: 5 }}>SHADE GUIDE</div>
                    <ShadeStrip height={8} />
                    <div style={{ fontSize: 10, color: C.sub, marginTop: 5 }}>方式×回数で白さの目安が変化</div>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* ---------- 使い方3ステップ ---------- */}
          <section style={{ background: C.champagne, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, padding: "24px 0 28px" }}>
            <div className="hm-container">
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                <h2 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, letterSpacing: 1, margin: 0 }}>使い方は、3ステップ</h2>
                <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 2, color: C.goldDark }}>HOW TO USE</span>
                <button
                  onClick={goSim}
                  style={{ marginLeft: "auto", border: `1.5px solid ${C.gold}`, background: C.card, color: C.goldDark, fontWeight: 900, fontSize: 12, borderRadius: 999, padding: "8px 20px", letterSpacing: 1 }}
                >
                  さっそく試す →
                </button>
              </div>
              <div className="hm-steps">
                {HOWTO_STEPS.map((s, i) => (
                  <div key={s.title} className="hm-step-card" onClick={goSim} style={{ background: C.card, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.line}`, cursor: "pointer" }}>
                    <img src={s.img} alt={`STEP${i + 1} ${s.title}`} style={{ width: "100%", display: "block", aspectRatio: "16 / 9", objectFit: "cover" }} loading="lazy" />
                    <div style={{ padding: "10px 14px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 999, background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, color: "#fff", fontSize: 12, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 2 }}>{i + 1}</div>
                      <div>
                        <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{s.title}</div>
                        <p style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------- 地域のおすすめ ---------- */}
          <div className="hm-container" style={{ paddingTop: 26, paddingBottom: 40 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <h2 style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, letterSpacing: 1, margin: 0 }}>近くのおすすめ</h2>
              <span style={{ fontSize: 11, color: C.sub }}>東京エリア・4店舗</span>
            </div>

            <div className="hm-clinics">
              {CLINICS.map((c) => (
                <div key={c.name} style={{ background: C.card, borderRadius: 18, padding: 18, border: `1px solid ${C.line}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 14.5, fontWeight: 700 }}>{c.name}</div>
                      <div style={{ fontSize: 11, color: C.sub, marginTop: 3 }}>{c.area}・{c.note}</div>
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.goldDark, background: C.champagne, border: `1px solid ${C.line}`, borderRadius: 8, padding: "4px 8px", height: "fit-content", whiteSpace: "nowrap" }}>{c.tag}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ color: C.gold, fontWeight: 700 }}>★ {c.rating}</span>
                      <span style={{ marginLeft: 10, fontWeight: 700 }}>{c.price}</span>
                    </div>
                    <button style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, border: "none", color: "#fff", fontWeight: 900, fontSize: 12, borderRadius: 999, padding: "9px 18px" }}>
                      予約ページへ
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: C.sub, lineHeight: 1.6, marginTop: 16 }}>
              ※掲載情報はサンプル(ダミー)です。※本アプリのシミュレーションは演出であり、実際の施術効果を保証するものではありません。
            </p>
          </div>
        </main>
      )}

      {screen === "sim" && (
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "0 16px 40px" }}>
          <button onClick={() => { stopCamera(); setScreen("home"); }} style={{ background: "none", border: "none", color: C.goldDark, fontWeight: 700, fontSize: 13, padding: "16px 0 12px" }}>
            ← ホームに戻る
          </button>

          {/* ---------- 画像エリア ---------- */}
          {!imgSrc && !cameraOn && (
            <div style={{ background: C.card, borderRadius: 20, padding: "36px 24px", textAlign: "center", border: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 40 }}>😁</div>
              <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 17, margin: "8px 0 4px" }}>歯が見える笑顔の写真を用意</div>
              <div style={{ fontSize: 12, color: C.sub, marginBottom: 20 }}>明るい場所で、歯がはっきり写っているほど精度が上がります</div>
              <label style={{ display: "block", background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, color: "#fff", fontWeight: 900, borderRadius: 14, padding: "14px 0", fontSize: 14, marginBottom: 10, cursor: "pointer" }}>
                📷 写真をアップロード
                <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
              </label>
              <button onClick={startCamera} style={{ width: "100%", background: C.card, color: C.goldDark, fontWeight: 900, borderRadius: 14, padding: "13px 0", fontSize: 14, border: `2px solid ${C.gold}` }}>
                🤳 インカメラで撮影
              </button>
              {camError && <div style={{ fontSize: 12, color: "#B4452F", marginTop: 12 }}>{camError}</div>}
              {imgStatus && <div style={{ fontSize: 12, color: imgStatus === "読み込み中…" ? C.sub : "#B4452F", marginTop: 12, lineHeight: 1.6, textAlign: "left" }}>{imgStatus}</div>}
            </div>
          )}

          {cameraOn && (
            <div style={{ background: "#000", borderRadius: 20, overflow: "hidden", position: "relative" }}>
              <video ref={videoRef} playsInline muted style={{ width: "100%", display: "block", transform: "scaleX(-1)" }} />
              <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12 }}>
                <button onClick={capture} style={{ background: "#fff", border: "none", borderRadius: 999, width: 64, height: 64, fontSize: 24 }}>📸</button>
                <button onClick={stopCamera} style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "1px solid #fff", borderRadius: 999, padding: "0 16px", fontWeight: 700 }}>閉じる</button>
              </div>
            </div>
          )}

          {imgSrc && (
            <>
              <div
                style={{ position: "relative", borderRadius: 20, overflow: "hidden", touchAction: "none", border: `1px solid ${C.line}` }}
                onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
              >
                <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />
                {editMode === "compare" && (
                  <>
                    <div style={{ position: "absolute", top: 10, left: 10, fontSize: 10, fontWeight: 900, background: "rgba(43,36,26,0.55)", color: "#fff", borderRadius: 6, padding: "4px 8px" }}>BEFORE</div>
                    <div style={{ position: "absolute", top: 10, right: 10, fontSize: 10, fontWeight: 900, background: C.gold, color: "#fff", borderRadius: 6, padding: "4px 8px" }}>AFTER</div>
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: `${split * 100}%`, width: 0 }}>
                      <div style={{ position: "absolute", top: "50%", left: -16, width: 32, height: 32, borderRadius: 999, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, transform: "translateY(-50%)" }}>⇔</div>
                    </div>
                  </>
                )}
                {editMode === "area" && (
                  <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, fontSize: 11, fontWeight: 700, background: "rgba(192,145,60,0.92)", color: "#fff", borderRadius: 10, padding: "8px 12px", textAlign: "center" }}>
                    ① 金色の枠をタップ/ドラッグで口元に合わせてください
                  </div>
                )}
              </div>
              {editMode === "area" && (
                <div style={{ background: C.card, borderRadius: 16, padding: 16, marginTop: 10, border: `1px solid ${C.line}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>枠の大きさ</div>
                  <input
                    type="range" min="0.07" max="0.32" step="0.005"
                    value={mouth.r}
                    onChange={(e) => setMouth((prev) => ({ ...prev, r: Number(e.target.value) }))}
                    style={{ width: "100%", accentColor: C.gold }}
                  />
                  <button
                    onClick={() => setEditMode("compare")}
                    style={{ width: "100%", marginTop: 10, background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, border: "none", color: "#fff", fontWeight: 900, fontSize: 14, borderRadius: 12, padding: "13px 0" }}
                  >
                    ② この範囲でシミュレーション開始
                  </button>
                </div>
              )}
              {editMode === "compare" && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                  <label style={{ fontSize: 12, color: C.goldDark, fontWeight: 700, cursor: "pointer" }}>
                    写真を変更
                    <input type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
                  </label>
                  <button onClick={() => setEditMode("area")} style={{ background: "none", border: `1.5px solid ${C.gold}`, color: C.goldDark, fontWeight: 700, fontSize: 11, borderRadius: 999, padding: "5px 12px" }}>
                    範囲を調整し直す
                  </button>
                  <span style={{ fontSize: 11, color: C.sub }}>スライダーで比較</span>
                </div>
              )}
              {imgStatus && <div style={{ fontSize: 12, color: "#B4452F", marginTop: 8, lineHeight: 1.6 }}>{imgStatus}</div>}

              {/* ---------- 方式 ---------- */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 900, marginBottom: 8 }}>ホワイトニングの方式</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {METHODS.map((mm) => (
                    <button key={mm.id} onClick={() => setMethod(mm.id)}
                      style={{
                        flex: 1, borderRadius: 14, padding: "12px 4px 10px",
                        border: method === mm.id ? `2px solid ${C.gold}` : `1.5px solid ${C.line}`,
                        background: method === mm.id ? C.champagne : C.card,
                      }}>
                      {METHOD_ICONS[mm.id] && (
                        <img src={METHOD_ICONS[mm.id]} alt="" aria-hidden="true" style={{ width: 40, height: 40, display: "block", margin: "0 auto 6px", opacity: method === mm.id ? 1 : 0.75 }} />
                      )}
                      <div style={{ fontWeight: 900, fontSize: 13, color: method === mm.id ? C.goldDark : C.ink }}>{mm.label}</div>
                      <div style={{ fontSize: 10, color: C.sub, marginTop: 2 }}>{mm.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* ---------- 回数 ---------- */}
              <div style={{ marginTop: 16, background: C.card, borderRadius: 16, padding: 16, border: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 900 }}>施術回数</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <button onClick={() => setSessions(Math.max(1, sessions - 1))} style={{ width: 36, height: 36, borderRadius: 999, border: `1.5px solid ${C.line}`, background: C.card, fontSize: 18, fontWeight: 700 }}>−</button>
                    <span style={{ fontSize: 20, fontWeight: 900, minWidth: 44, textAlign: "center" }}>{sessions}回</span>
                    <button onClick={() => setSessions(Math.min(6, sessions + 1))} style={{ width: 36, height: 36, borderRadius: 999, border: "none", background: C.gold, color: "#fff", fontSize: 18, fontWeight: 700 }}>＋</button>
                  </div>
                </div>

                {/* ---------- シェードガイド ---------- */}
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>シェードガイド(色見本)の目安</div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {SHADES.map((s, i) => (
                      <div key={s.name} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{
                          height: 34, borderRadius: 6, background: s.hex,
                          border: i === shadeIdx ? `3px solid ${C.gold}` : "3px solid transparent",
                          boxSizing: "border-box",
                        }} />
                        <div style={{ fontSize: 9, marginTop: 3, fontWeight: i === shadeIdx ? 900 : 400, color: i === shadeIdx ? C.goldDark : C.sub }}>{s.name}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 8, fontWeight: 700, color: C.goldDark }}>
                    {m.label}ホワイトニング {sessions}回で「{SHADES[shadeIdx].name}」相当の白さイメージ
                  </div>
                </div>
              </div>

              {/* ---------- CTA ---------- */}
              <button onClick={() => setScreen("home")}
                style={{ width: "100%", marginTop: 20, background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, border: "none", color: "#fff", fontWeight: 900, fontSize: 15, borderRadius: 16, padding: "16px 0", boxShadow: "0 6px 18px rgba(192,145,60,0.35)" }}>
                この白さにできるお店を探す →
              </button>

              <p style={{ fontSize: 10, color: C.sub, lineHeight: 1.6, marginTop: 14 }}>
                ※本シミュレーションは画像演出によるイメージであり、実際の施術効果・到達シェードを保証するものではありません。効果には個人差があります。※アップロードした画像は端末内でのみ処理され、サーバーには送信されません。
              </p>
            </>
          )}
        </main>
      )}

      {/* ---------- エリア選択モーダル(準備中の案内) ---------- */}
      {showAreaNote && (
        <div
          onClick={() => setShowAreaNote(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(43,36,26,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 24 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 20, padding: 24, maxWidth: 320, width: "100%" }}>
            <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 17, marginBottom: 8 }}>エリア選択は準備中です</div>
            <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, margin: "0 0 16px" }}>
              現在は東京エリアの店舗情報を掲載しています。他エリアは順次拡大予定です。
            </p>
            <button
              onClick={() => setShowAreaNote(false)}
              style={{ width: "100%", background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, border: "none", color: "#fff", fontWeight: 900, fontSize: 14, borderRadius: 12, padding: "12px 0" }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* ---------- フッター ---------- */}
      <footer style={{ borderTop: `1px solid ${C.line}`, background: C.champagne }}>
        <ShadeStrip height={5} radius={0} />
        <div style={{ padding: "26px 20px 40px", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: C.sub, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
            <a href="/privacy.html" style={{ color: C.sub }}>プライバシーポリシー</a>
            <a href="/terms.html" style={{ color: C.sub }}>免責事項</a>
            <a href="/about.html" style={{ color: C.sub }}>運営者情報</a>
          </div>
          <div style={{ fontSize: 10, color: C.sub, marginTop: 10 }}>© 2026 ハミュレーション</div>
        </div>
      </footer>
    </div>
  );
}
